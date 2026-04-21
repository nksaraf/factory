# Effect-ify Site Orchestration Layer

## Context

The site orchestration layer (`cli/src/site/` + `cli/src/lib/site-orchestrator.ts`) is the "kubelet" of the dx CLI — it manages site lifecycle across local dev (`dx dev`), containerized dev (`dx up`), production VMs (site controller daemon), previews, and future k8s clusters. Today it's ~4K+ lines of imperative, class-based TypeScript with manual `setInterval` loops, a `shutdownCallbacks[]` array for cleanup, and `try/catch` error handling scattered throughout. The 49KB `SiteOrchestrator` god class does everything: state management, port resolution, connection logic, execution, tunneling, build caching, and orchestration flow.

An Effect foundation already exists across three packages:

- **`shared/src/effect/`**: Branded IDs (`Schema`-based), `TaggedError` classes, re-exports
- **`api/src/effect/`**: Services (Db, Secrets, Ontology, SpecResolver, DnsProvider), reconciliation primitives (diffSets, reconcileSet, DeduplicatingQueue, CircuitBreaker, ReconcilerRuntime), factory bindings, bridge
- **`cli/src/effect/`**: CliConfig, FactoryApi, `runEffect` bridge

This is a fresh-start opportunity. We're not just wrapping old classes in Effect — we're decomposing the god class, removing deprecated code paths (`controller-server.ts`, `start.ts`), applying kubelet-grade patterns (conditions-driven phase, probe execution, finalizers, generation tracking), and building reusable primitives that the rest of the codebase can use as we migrate more systems to Effect. The `SiteOrchestrator` class ceases to exist — its responsibilities become focused services composed by thin programs.

## Naming Conventions

Clean names established for this design. No legacy names survive.

| Concept                    | Name                        | Why                                                  |
| -------------------------- | --------------------------- | ---------------------------------------------------- |
| Docker Compose executor    | `DockerComposeExecutor`     | Explicit about runtime                               |
| Native process executor    | `DevProcessExecutor`        | It runs dev server processes, "native" is vague      |
| Mode-routing executor      | `RoutingExecutor`           | It routes by component mode                          |
| Cross-system linking       | `CrossSystemLinker`         | Links components across system boundaries            |
| Dependency connection      | `DependencyConnector`       | Connects to external deps (profiles, connect flags)  |
| Docker Compose operations  | `DockerComposeOps`          | Bulk compose ops (build, override files, env files)  |
| Factory API communication  | `ControlPlaneLink`          | Generic — could be Factory, k8s API server, anything |
| Workspace/system discovery | `WorkspaceDiscovery`        | Discovers which system you're working on from cwd    |
| "Project context"          | `FocusSystem` on SiteConfig | The system you're developing — one of N possible SDs |
| Atomic state persistence   | `ConfigStore`               | Interface over coordination mode, not file format    |
| `SiteOrchestrator`         | **Eliminated**              | Decomposed into services + programs. No god class.   |

## How the Catalog Flows

The catalog is **data, not a service**. It's compile-time (parsed from `docker-compose.yaml` via `DockerComposeFormatAdapter`), embedded in the manifest, and passed through as a plain object. The CLI never touches the Ontology service (that's API-side for DB entities).

```
docker-compose.yaml + dx labels
        │
        ▼
DockerComposeFormatAdapter (shared/src/formats/)
        │
        ▼
CatalogSystem IR (shared/src/catalog.ts)
        │
        ├──→ Embedded in SiteConfig.focusSystem.catalog
        │        Used by: PortRegistry, DependencyConnector, CrossSystemLinker, programs
        │
        ├──→ Embedded in SiteManifest.catalog (controller mode)
        │        Used by: SiteReconciler for topology ordering, init detection
        │
        └──→ Synced to DB via POST /catalog/sync
                 Accessed by: Ontology service (API-side only)
```

Systems and components are represented as `CatalogSystem.components` / `CatalogSystem.resources` in the CLI. The type system already distinguishes them. No separate "catalog service" — the catalog is a property of the project context.

## Kubelet Patterns Adopted

### Conditions-Driven Phase

Today the code does `setPhase("running")` directly. Wrong. The kubelet sets _conditions_ and the phase is _derived_. We already have the condition schema (`shared/src/site-state.ts:21-33`) but it's barely populated.

**New pattern**: The reconciler sets conditions after every step. Phase is computed from conditions, never set directly.

```
Conditions set by reconciler/health monitor:
  { type: "Deployed",       status: "True",  reason: "DockerComposeUpSucceeded" }
  { type: "Healthy",        status: "True",  reason: "LivenessProbeSucceeded" }
  { type: "Ready",          status: "False", reason: "ReadinessProbeTimedOut", message: "GET /health returned 503" }
  { type: "DependenciesReady", status: "True", reason: "AllDepsRunning" }

Phase derivation:
  all Ready=True + all Healthy=True → "running"
  any Ready=False OR any Healthy=False → "degraded"
  all Deployed=False → "stopped"
  any condition reason contains "Fatal" → "failed"
```

`lastTransitionTime` becomes mandatory (auto-set by the condition setter, not optional).

### Probe Execution

The probe config schema exists (`readinessProbe`, `livenessProbe` on `ComponentDeploymentSpec`) but nobody runs them. The HealthMonitor will actually execute probes now:

- **Startup probe**: New. Long grace period for slow-starting services. While startup probe is running, liveness is suspended.
- **Liveness probe**: Failure → restart the component (via `Executor.restart`). Like kubelet killing a pod.
- **Readiness probe**: Failure → mark not-ready condition. Don't route traffic. Report degraded.

Probe types: `http` (GET → 200), `tcp` (connect succeeds), `exec` (command exits 0).

### Finalizers

Before stopping a component, run its finalizers in order:

- `drain-connections` → stop accepting new requests (readiness → false)
- `flush-state` → persist buffered writes
- `remove-routes` → remove from gateway

Finalizers are declared in component spec and tracked in status. A component can't be stopped until all finalizers complete (or timeout).

### Generation / ObservedGeneration

Already partially exists. Made systematic:

- `spec.generation` incremented on every intent change (via `bumpGeneration`)
- `status.observedGeneration` set after successful reconciliation
- `generation != observedGeneration` means "pending changes not yet applied"
- Visible in `dx status` output

### Event Correlation

Every reconcile cycle gets a `reconciliationId` (UUID). Every step, condition change, and error within that cycle carries it. Enables: "show me everything that happened when component X broke."

## Error Design

Every error carries actionable, context-specific suggestions. Suggestions distinguish human actions from agent-actionable commands.

```typescript
interface ErrorSuggestion {
  action: string // the command or action to take
  description: string // why this helps
  agentActionable?: boolean // can an AI agent execute this?
}
```

### Error catalog (site-specific)

```typescript
DockerNotAvailableError {
  suggestions: [
    { action: "open -a Docker", description: "Start Docker Desktop", agentActionable: true },
    { action: "dx status", description: "Check environment health", agentActionable: true },
  ]
}

PortConflictError {
  port, component,
  suggestions: [
    { action: `lsof -i :${port}`, description: `Find process using port ${port}`, agentActionable: true },
    { action: `dx dev stop ${component}`, description: "Stop the component holding the port", agentActionable: true },
  ]
}

ExecutorError {
  executor: "docker-compose", operation: "deploy", component, cause,
  suggestions: [
    { action: `docker compose logs ${component}`, description: "Check container logs for details", agentActionable: true },
    { action: `dx dev --no-build`, description: "Skip builds and use cached images" },
  ]
}

ProcessSpawnError {
  component, cmd,
  suggestions: [
    { action: `cat .dx/dev/${component}.log`, description: "Check dev server log", agentActionable: true },
    { action: `which ${cmd[0]}`, description: "Verify the runtime is installed", agentActionable: true },
  ]
}

ControlPlaneLinkError {
  operation, statusCode,
  suggestions: [
    { action: "dx auth login", description: "Re-authenticate with Factory", agentActionable: true },
    { action: "dx config get factory.url", description: "Verify Factory URL is correct", agentActionable: true },
    { action: "--standalone", description: "Run without Factory connection" },
  ]
}

ComponentNotFoundError {
  component, available,
  suggestions: [
    { action: `dx catalog tree`, description: "Show available components", agentActionable: true },
    { action: `Did you mean: ${closestMatch}?`, description: "Possible typo" },
  ]
}

StateCorruptionError {
  path,
  suggestions: [
    { action: `rm ${path} && dx dev`, description: "Delete corrupted state and restart", agentActionable: true },
    { action: `cat ${path} | jq .`, description: "Inspect the corrupted file", agentActionable: true },
  ]
}
```

The bridge (`effectErrorToDxError`) passes suggestions through. When an error doesn't have context-specific suggestions, it falls back to the ErrorRegistry defaults for that error code.

---

## Part 1: Reusable Effect Primitives (shared/)

### Why shared?

The reconciliation primitives currently live in `api/src/effect/reconcile/`, but `@smp/factory-api` doesn't export them (no `./effect/reconcile` export path). They have **zero API-specific dependencies** — they're pure Effect code. Meanwhile, `@smp/factory-shared` has wildcard exports (`"./effect/*": "./src/effect/*.ts"`), so anything placed in `shared/src/effect/` is immediately importable from both `api` and `cli`.

Several patterns in the site orchestration layer are not site-specific — they're infrastructure primitives that any long-running daemon, build agent, monitoring system, or orchestrator will need. Building them in `shared/` means we invest once and reuse across every future Effect migration.

### 1.1 Move reconciliation primitives to shared

**Move** `api/src/effect/reconcile/` → `shared/src/effect/reconcile/` (all 7 files).

Files: `diff-sets.ts`, `reconcile-set.ts`, `reconciler.ts`, `runtime.ts`, `dedup-queue.ts`, `circuit-breaker.ts`, `index.ts`

Update `api/src/effect/reconcile/` to re-export from `@smp/factory-shared/effect/reconcile` (one-line change per file, no breakage).

### 1.2 JsonFileStore — generic atomic JSON persistence

The codebase has at least 4 places doing the same pattern: read JSON file → parse → modify in memory → write to tmp → atomic rename. Today these are independent implementations in:

- `StateStore` (`cli/src/site/state.ts`) — controller state
- `SiteManager` (`cli/src/lib/site-manager.ts`) — site.json
- `agent-lifecycle.ts` — agent.json
- `host-ports.json` — port registry

**New: `shared/src/effect/json-file-store.ts`**

```typescript
interface JsonFileStore<T> {
  readonly get: Effect<T, StateCorruptionError>
  readonly set: (value: T) => Effect<void, StateCorruptionError>
  readonly update: (f: (current: T) => T) => Effect<void, StateCorruptionError>
  readonly delete: Effect<void>
  readonly path: string
}
```

Implementation: `Ref<T>` for in-process reads (fast, consistent within one process), atomic write (tmp + rename) for persistence. `Scope` finalizer flushes on shutdown.

**Multi-process coordination note**: The `Ref` provides consistency within the daemon process. CLI subcommands (`dx dev start <component>`, `dx dev ps`) running in separate processes go through the agent's HTTP API — they don't touch the file directly. The file is the persistence layer, not the coordination layer.

### 1.3 ProcessManager — generic child process lifecycle

Not site-specific. Any CLI tool that orchestrates external processes (build agents, test runners, dev tools) needs safe spawn/kill with PID tracking and Scope-based cleanup.

**New: `shared/src/effect/process-manager.ts`**

```typescript
interface ProcessManager {
  readonly spawn: (opts: SpawnOpts) => Effect<SpawnResult, ProcessError, Scope>
  readonly kill: (pid: number, signal?: string) => Effect<void, ProcessError>
  readonly killTree: (pid: number) => Effect<void, ProcessError>
  readonly isRunning: (pid: number) => Effect<boolean>
}
```

- `Scope` on `spawn` = process auto-killed when scope closes. Replaces manual `shutdownCallbacks`.
- `killTree` replaces the `Atomics.wait` busy-loop with `Effect.sleep(50ms)` + `Effect.retry(Schedule.recurs(40))` — non-blocking, interruptible.
- Cross-platform: `process.kill(-pid)` for process groups, fallback to single PID.

### 1.4 HealthProbe — generic periodic health + PubSub

Any long-running system needs periodic health probing with snapshot publication.

**New: `shared/src/effect/health-probe.ts`**

```typescript
interface HealthProbeConfig<S> {
  readonly check: Effect<S, never, never>
  readonly interval: Duration
  readonly degradedCallback?: (snapshot: S) => Effect<void>
}

interface HealthProbe<S> {
  readonly latest: Effect<S | null>
  readonly changes: PubSub<S>
  readonly fiber: Effect<never> // fork this
}
```

Used by: `HealthMonitor` (site), future API health checks, database connection pool monitors.

### 1.5 PortRegistry — generic port allocation

**New: `shared/src/effect/port-registry.ts`**

```typescript
interface PortRegistry {
  readonly allocate: (
    requests: PortRequest[]
  ) => Effect<Record<string, number>, PortConflictError>
  readonly allocateMulti: (
    requests: ServicePortRequest[]
  ) => Effect<Record<string, Record<string, number>>, PortConflictError>
  readonly isAvailable: (port: number) => Effect<boolean>
  readonly release: (port: number) => Effect<void>
  readonly snapshot: Effect<PortAllocation[]>
}
```

Port probing (`createServer().listen()`) maps naturally to `Effect.async`. Host-level registry file uses `JsonFileStore<PortRegistryState>`.

### 1.6 EventJournal — generic bounded event ring buffer

The current `SiteController` has a 200-event ring buffer for reconcile events. This pattern is useful for any system that needs recent-event observability without unbounded memory growth.

**New: `shared/src/effect/event-journal.ts`**

```typescript
interface EventJournal<E> {
  readonly emit: (event: E) => Effect<void>
  readonly recent: Effect<ReadonlyArray<E>>
  readonly subscribe: PubSub<E>
}
```

Backed by `Ref<CircularBuffer<E>>`. Max size configurable. Subscribers get real-time events via PubSub; `recent` returns the buffer snapshot (for HTTP API responses like `/events`).

### 1.7 Rename JsonFileStore → ConfigStore

`JsonFileStore` describes an implementation detail (JSON files). The actual abstraction is managing configuration/state across three coordination modes:

- **In-process** (`Ref<T>`) — fast reads within one process
- **File-persisted** — survives restarts, atomic writes
- **API-mediated** — cross-process coordination via HTTP

**New: `shared/src/effect/config-store.ts`**

```typescript
interface ConfigStore<T> {
  readonly get: Effect<T, StateCorruptionError>
  readonly set: (value: T) => Effect<void, StateCorruptionError>
  readonly update: (f: (current: T) => T) => Effect<void, StateCorruptionError>
  readonly delete: Effect<void>
}
```

Layer constructors:

- `ConfigStore.jsonFile(path, schema)` — Ref + atomic JSON file (the common case)
- `ConfigStore.memory(initial)` — Ref only, no persistence (testing)
- Future: `ConfigStore.api(url)` — reads/writes via HTTP API

The implementation is file-based today. The interface is not.

---

## Observability: Effect Spans

Currently only `reconcileSet` has `Effect.withSpan`. We add spans at every meaningful boundary — the goal is: given a slow `dx dev` startup, you can see exactly where time was spent without adding log statements.

### Span placement strategy

**Service entry points** — every public method on every service gets a span:

```typescript
// In SiteReconcilerLive
reconcile: pipe(
  reconcileImpl,
  Effect.withSpan("SiteReconciler.reconcile", {
    attributes: {
      "site.mode": config.mode,
      "manifest.version": manifest.version,
    },
  })
)
```

**Executor operations** — each deploy/stop/inspect gets a span with component context:

```typescript
deploy: (component, desired) =>
  pipe(
    deployImpl(component, desired),
    Effect.withSpan("DockerComposeExecutor.deploy", {
      attributes: {
        "component.name": component,
        "component.image": desired.image,
      },
    })
  )
```

**Key operations to instrument:**

| Span                             | Attributes                | Why                                       |
| -------------------------------- | ------------------------- | ----------------------------------------- |
| `DevSession.run`                 | mode, componentCount      | Top-level: total session startup time     |
| `DevSession.resolveConnections`  | profileName, remoteDeps[] | Connection setup is often slow            |
| `DevSession.startDockerDeps`     | services[], needsBuild    | Docker pulls/builds are the #1 bottleneck |
| `PortRegistry.allocate`          | requestCount              | Port probing can be slow on busy machines |
| `DockerComposeExecutor.deploy`   | component, image          | Per-component deploy time                 |
| `DockerComposeExecutor.inspect`  | —                         | Docker ps can be slow                     |
| `DevProcessExecutor.deploy`      | component, runtime        | Per-process spawn time                    |
| `ProcessManager.spawn`           | cmd, pid                  | Track time to spawn + become healthy      |
| `ProcessManager.killTree`        | pid                       | Track time to kill process tree           |
| `SiteReconciler.reconcile`       | cycleId, manifestVersion  | Per-reconcile-cycle duration              |
| `SiteReconciler.executeStep`     | action, component         | Per-step duration within a cycle          |
| `ControlPlaneLink.fetchManifest` | —                         | Factory API latency                       |
| `ControlPlaneLink.reportState`   | componentCount            | Report latency                            |
| `HealthMonitor.checkCycle`       | componentCount            | Health check sweep time                   |
| `HealthMonitor.runProbe`         | component, probeType      | Per-probe execution time                  |
| `TunnelManager.open`             | subdomain                 | Tunnel setup time                         |
| `DockerComposeOps.build`         | services[]                | Build time tracking                       |
| `DockerComposeOps.up`            | services[], detach        | Compose up time                           |
| `ConfigStore.set`                | path                      | File write latency (detect slow FS)       |
| `AgentServer.handleRequest`      | route, method             | Per-HTTP-request latency                  |

**Reconciliation cycle gets a parent span** that all child operations nest under:

```typescript
const reconcileCycle = Effect.gen(function* () {
  // All steps, conditions, health checks nest as child spans
}).pipe(
  Effect.withSpan("SiteReconciler.cycle", {
    attributes: { "reconciliation.id": cycleId },
  })
)
```

**Not instrumented:** Pure functions (planChanges, topologicalOrder, detectServiceType), config reads from Ref (nanosecond operations), PubSub publish/subscribe.

---

## Error Self-Conversion (no centralized switch/case)

The current `effectErrorToDxError` in `bridge.ts` is a 150-line switch/case that grows with every new error type. This doesn't scale. Instead, errors should know how to present themselves in both CLI and API contexts.

### Design: `toDxError()` and `toAppError()` on every error

Every error class in `shared/src/effect/errors.ts` already has `get message()` and `get httpStatus()`. We add two conversion methods to the base pattern:

```typescript
export class PortConflictError extends Schema.TaggedError<PortConflictError>()(
  "PortConflictError",
  {
    port: Schema.Number,
    component: Schema.String,
    cause: Schema.optional(Schema.String),
    suggestions: Suggestions,
  }
) {
  get message() {
    return `Port ${this.port} already in use for ${this.component}`
  }
  get httpStatus() {
    return 409
  }

  get errorCode() {
    return "PORT_CONFLICT"
  }

  get cliMetadata(): Record<string, unknown> {
    return { port: this.port, component: this.component }
  }
}
```

The bridge becomes generic — no switch/case:

```typescript
export async function runEffect<A, E extends FactoryError>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Promise<A> {
  const exit = await Effect.runPromiseExit(effect)
  if (Exit.isSuccess(exit)) return exit.value

  const failure = Cause.failureOption(exit.cause)
  if (Option.isSome(failure)) {
    const err = failure.value
    throw new DxError(err.message, {
      operation,
      code: err.errorCode,
      metadata: err.cliMetadata,
      suggestions:
        err.suggestions?.map((s) => ({
          action: s.action,
          description: s.description,
        })) ?? registrySuggestions(err.errorCode),
    })
  }
  // ... defect handling unchanged
}
```

**What this means**: Adding a new error type requires zero changes to `bridge.ts`. The error class itself defines how it presents in CLI and API contexts. The `errorCode`, `httpStatus`, `message`, `cliMetadata`, and `suggestions` are all on the error. The bridge is just a generic adapter that reads these properties.

The existing errors in `shared/src/effect/errors.ts` already have `message` and `httpStatus`. We add `errorCode` and `cliMetadata` to each. The `suggestions` field already exists on most errors (via `Schema.optional(Schema.Array(RecoverySuggestion))`).

---

## Naming: "Project" Is Gone

The CLI uses "project" to mean a docker-compose root. But that's a **system** in the ontology. And a site can have **multiple system deployments** — the schema is `siteSpec.systemDeployments: LocalSystemDeployment[]`. The current `SiteOrchestrator` works with one "focus SD" (`sdSlug`) plus linked SDs from other sites. So "project context" as a single thing is misleading.

### What the discovery service actually does

When you run `dx dev`, the CLI walks up from cwd to find a docker-compose root. That gives you:

- Which **system** you're working on (the focus system)
- Its catalog (components, resources, APIs parsed from compose labels)
- Its compose files, conventions, packages

This is **workspace discovery** — "given my cwd, what am I working on?"

### Naming

| Old                          | New                   | Why                                                        |
| ---------------------------- | --------------------- | ---------------------------------------------------------- |
| `WorkspaceDiscovery` service | `WorkspaceDiscovery`  | It discovers what you're working on from cwd               |
| `ProjectContextData`         | `DiscoveredWorkspace` | The result of discovery                                    |
| `project` on SiteConfig      | `focusSystem`         | The system you're developing — one of potentially many SDs |

```typescript
interface SiteConfig {
  readonly mode: "dev" | "up" | "controller"
  readonly workingDir: string
  readonly port: number
  readonly focusSystem: FocusSystem // the system discovered from cwd
  readonly controllerMode?: "connected" | "standalone" | "air-gapped"
  readonly reconcileIntervalMs: number
}

interface FocusSystem {
  readonly name: string // system name (from catalog or dx config)
  readonly sdSlug: string // system deployment slug for this system
  readonly rootDir: string // absolute path to system root
  readonly catalog: CatalogSystem // parsed service catalog
  readonly composeFiles: string[] // docker-compose file paths
  readonly conventions: ConventionsConfig
  readonly dxConfig: DxProjectConfig
  readonly packages: MonorepoPackage[]
}
```

`focusSystem` is explicit: it's the one system you're actively developing. Linked systems from other sites (`--connect-to staging`) are separate SDs in the site state — the `CrossSystemLinker` handles those. The site can have N system deployments; the focus system is the one the daemon was started for.

The `WorkspaceDiscovery` service:

```typescript
interface WorkspaceDiscovery {
  readonly discover: Effect<DiscoveredWorkspace>
}
```

It wraps `resolveDxContext()` (which we don't rename — it's internal to the discovery implementation). The service name and its output type use the new vocabulary.

---

## Coexistence Strategy: New Code Alongside Old

All new Effect code lives in new files under `cli/src/effect/`. The old code stays untouched until we're confident the new code works. The switch happens in one place: `agent-daemon.ts`.

### How it works

**Phase 1-5**: Write all new services and programs in `cli/src/effect/services/`, `cli/src/effect/layers/`, `cli/src/effect/programs/`. None of the old files are modified. Both code paths exist simultaneously.

**Phase 6**: Add a flag to `agent-daemon.ts`:

```typescript
const USE_EFFECT = process.env.DX_EFFECT_RUNTIME === "1"

if (USE_EFFECT) {
  // New path: compose layer, run Effect program
  const layer = createLayer(opts)
  await Effect.runPromise(agentProgram.pipe(Effect.provide(layer)))
} else {
  // Old path: existing imperative code (unchanged)
  const orch = await SiteOrchestrator.create(...)
  // ... existing code
}
```

**Testing**: Run `DX_EFFECT_RUNTIME=1 dx dev` to test the new path. Run plain `dx dev` for the old path. Both work.

**Phase 7**: Remove the flag, make Effect the default. Old code becomes dead code.

**Phase 8**: Delete old files (`site-orchestrator.ts`, `agent.ts`, `controller.ts`, `health.ts`, `state.ts`, old executor classes).

### What this means for file organization

```
cli/src/
  lib/
    site-orchestrator.ts   ← OLD: untouched until Phase 8
    site-manager.ts        ← OLD: untouched until Phase 8
    port-manager.ts        ← OLD: untouched until Phase 8
    ...
  site/
    controller.ts          ← OLD: untouched until Phase 8
    health.ts              ← OLD: untouched until Phase 8
    agent.ts               ← OLD: untouched until Phase 8
    agent-daemon.ts        ← MODIFIED in Phase 6 only (flag to select path)
    execution/
      compose.ts           ← OLD: untouched until Phase 8
      native.ts            ← OLD: untouched until Phase 8
      ...
  effect/
    services/              ← NEW: all new files
    layers/                ← NEW: all new files
    programs/              ← NEW: all new files
    runtime.ts             ← NEW
```

No old file is edited until the new code is proven. The only bridge point is `agent-daemon.ts` with the environment flag.

## Part 2: Site-Specific Service Architecture

### Error Types (`cli/src/effect/errors/site.ts`)

Every error carries `_tag` discrimination, `httpStatus`, `message`, and `suggestions: ErrorSuggestion[]`. Suggestions are context-specific (constructed with actual port numbers, component names, file paths — not templates).

| Error                     | Fields                                 | When                          |
| ------------------------- | -------------------------------------- | ----------------------------- |
| `ExecutorError`           | executor, operation, component, cause? | Any executor op fails         |
| `ProcessSpawnError`       | component, cmd, cause?                 | Dev process spawn fails       |
| `PortConflictError`       | port, component, cause?                | Port in use or alloc failed   |
| `DockerNotAvailableError` | —                                      | Docker daemon unreachable     |
| `ManifestError`           | reason, version?                       | Invalid/missing manifest      |
| `ControlPlaneLinkError`   | operation, statusCode?, cause?         | Control plane comms           |
| `StateCorruptionError`    | path, cause?                           | State file unreadable         |
| `ComponentNotFoundError`  | component, available[]                 | Component not in catalog      |
| `CircularDependencyError` | components[]                           | Topology cycle                |
| `TunnelError`             | operation, cause?                      | Tunnel failure                |
| `BuildError`              | component, cause?                      | Docker build failure          |
| `ConnectionError`         | profile, cause?                        | Connection resolution failure |
| `ProbeFailedError`        | component, probeType, cause?           | Health probe failure          |
| `FinalizerTimeoutError`   | component, finalizer                   | Finalizer didn't complete     |

### Service Dependency Graph

```
Layer 0 (Config)
  SiteConfig ─── WorkspaceDiscovery

Layer 1 (Shared Primitives — from shared/)
  JsonFileStore ─── PortRegistry ─── ProcessManager ─── HealthProbe ─── EventJournal

Layer 2 (Site State)
  SiteState ─── ControllerStateStore ─── AgentStateStore
                    (all use JsonFileStore)

Layer 3 (Executors)
  DockerComposeOps ─── DevProcessExecutor ─── DockerComposeExecutor ─── KubernetesExecutor
                              │                         │
                              └────────┬────────────────┘
                               RoutingExecutor (provides Executor)
                               reads component mode from SiteState per-operation

Layer 4 (Orchestration)
  SiteReconciler ─── HealthMonitor ─── ControlPlaneLink ─── GatewayReconciler
  DependencyConnector ─── CrossSystemLinker ─── TunnelManager ─── BuildCache

Layer 5 (Daemon)
  AgentServer (Elysia + ManagedRuntime bridge)

Programs (top-level, not services — these replace SiteOrchestrator)
  DevSession ─── UpSession ─── ControllerDaemon ─── AgentDaemon
  DevPrelude (foreground pre-daemon phase, stays imperative)
```

### Layer 0 — Config

**SiteConfig** — `Context.Tag`. Aggregates all config needed by the site daemon.

```typescript
interface SiteConfig {
  readonly mode: "dev" | "up" | "controller"
  readonly workingDir: string
  readonly port: number
  readonly focusSystem: FocusSystem // the system discovered from cwd
  readonly controllerMode?: "connected" | "standalone" | "air-gapped"
  readonly reconcileIntervalMs: number
}
```

**WorkspaceDiscovery** — Discovers which system you're working on from cwd. Wraps `resolveDxContext()` (project discovery, toolchain detection, catalog parsing).

```typescript
interface WorkspaceDiscovery {
  readonly discover: Effect<DiscoveredWorkspace>
}
```

Layer constructors for SiteConfig:

- `SiteConfigFromDaemonOpts(opts: SpawnAgentOpts)` — used by `agent-daemon.ts`. Reads the config JSON that the CLI foreground process wrote.
- `SiteConfigFromCli(flags)` — used by one-shot CLI commands (`dx dev start`, `dx dev ps`). Uses `WorkspaceDiscovery` inline.
- `SiteConfigFromEnv()` — used by production controller deployments.

**Why WorkspaceDiscovery matters**: `SiteOrchestrator.create()` does branching async logic (load existing site vs init new, hostname detection, mode setting, SD setup). This doesn't fit a simple `Layer.succeed()`. `WorkspaceDiscovery` provides the resolved context; the site initialization logic lives in the `DevSession` / `UpSession` programs where it belongs — not baked into a Layer constructor.

### Layer 2 — Site State Services

**SiteState** — Read/write `.dx/site.json`. Uses `JsonFileStore<SiteStateData>`.

```typescript
interface SiteState {
  // Reads (from in-process Ref — fast, no I/O)
  readonly getState: Effect<SiteStateData>
  readonly getSpec: Effect<SiteSpec>
  readonly getStatus: Effect<LocalSiteStatus>
  readonly getSystemDeployment: (
    slug: string
  ) => Effect<LocalSystemDeployment | null>
  readonly getComponentMode: (
    sdSlug: string,
    component: string
  ) => Effect<ComponentDeploymentMode | null>

  // Writes (update Ref + queue atomic file flush)
  readonly ensureSystemDeployment: (
    slug: string,
    systemSlug: string,
    runtime: string,
    composeFiles: string[]
  ) => Effect<LocalSystemDeployment>
  readonly ensureLinkedSystemDeployment: (
    slug: string,
    systemSlug: string,
    linkedRef: LinkedRef
  ) => Effect<void>
  readonly setComponentMode: (
    sdSlug: string,
    component: string,
    mode: ComponentDeploymentMode,
    opts?: object
  ) => Effect<void>
  readonly updateComponentStatus: (
    sdSlug: string,
    component: string,
    status: Partial<ComponentDeploymentStatus>
  ) => Effect<void>
  readonly setPhase: (phase: SitePhase) => Effect<void>
  readonly setResolvedEnv: (
    sdSlug: string,
    env: Record<string, ResolvedEnvEntryLocal>,
    tunnels: TunnelEntry[]
  ) => Effect<void>
  readonly bumpGeneration: (sdSlug: string, component: string) => Effect<void>

  // Lifecycle
  readonly resetIntent: Effect<Map<string, SavedComponentStatus>> // regenerate intent, preserve runtime status
  readonly restoreStatus: (
    sdSlug: string,
    component: string,
    saved: Map<string, SavedComponentStatus>
  ) => Effect<void>
  readonly save: Effect<void, StateCorruptionError> // flush to disk
  readonly setMode: (mode: "dev" | "up") => Effect<void>
  readonly init: (
    siteOpts: SiteInitOpts,
    workbenchOpts: WorkbenchInitOpts,
    mode: "dev" | "up"
  ) => Effect<void>
}
```

**ControllerStateStore** — Manifest history + image rollback for controller mode. Uses `JsonFileStore<ControllerState>`.

```typescript
interface ControllerStateStore {
  readonly getLastManifest: Effect<SiteManifest | null>
  readonly saveManifest: (
    manifest: SiteManifest
  ) => Effect<void, StateCorruptionError>
  readonly recordImageDeploy: (
    component: string,
    image: string,
    version: number
  ) => Effect<void>
  readonly getPreviousImage: (component: string) => Effect<string | null>
  readonly getImageHistory: (component: string) => Effect<ImageHistoryEntry[]>
}
```

**AgentStateStore** — Agent lifecycle state (`.dx/agent.json`). Uses `JsonFileStore<AgentState>`.

```typescript
interface AgentStateStore {
  readonly read: Effect<AgentState | null>
  readonly write: (state: AgentState) => Effect<void>
  readonly clear: Effect<void>
}
```

### Layer 3 — Executors

**Executor** — `Context.Tag`. The core execution interface. Returns `Effect` instead of `Promise`.

```typescript
interface Executor {
  readonly type: string
  readonly parseCatalog: Effect<CatalogSystem, ExecutorError>
  readonly inspect: Effect<ComponentState[], ExecutorError>
  readonly inspectOne: (
    component: string
  ) => Effect<ComponentState, ExecutorError | ComponentNotFoundError>
  readonly deploy: (
    component: string,
    desired: DesiredComponentState
  ) => Effect<DeployResult, ExecutorError>
  readonly stop: (
    component: string,
    opts?: { finalizers?: boolean }
  ) => Effect<void, ExecutorError | FinalizerTimeoutError>
  readonly scale: (
    component: string,
    replicas: number
  ) => Effect<void, ExecutorError>
  readonly restart: (component: string) => Effect<void, ExecutorError>
  readonly runInit: (
    initName: string
  ) => Effect<{ exitCode: number; output: string }, ExecutorError>
  readonly logs: (
    component: string,
    opts?: LogOpts
  ) => Effect<string, ExecutorError>
  readonly logStream: (
    component: string,
    opts?: LogOpts
  ) => Stream<string, ExecutorError>
  readonly run: (
    component: string,
    cmd: string[]
  ) => Effect<RunResult, ExecutorError>
  readonly healthCheck: (
    component: string
  ) => Effect<HealthStatus, ExecutorError>
  readonly healthCheckAll: Effect<Record<string, HealthStatus>, ExecutorError>
  readonly runProbe: (
    component: string,
    probe: ProbeConfig
  ) => Effect<ProbeResult, ProbeFailedError>
}
```

`logStream` returns `Stream<string>` for SSE endpoints. `runProbe` executes liveness/readiness/startup probes. `stop` accepts `{ finalizers: true }` to run declared finalizers before stopping.

**DockerComposeOps** — Direct Docker Compose operations that don't fit the Executor interface. The DependencyConnector's apply flow needs: build images, stop specific services, write override files, start with env files and `--no-deps`. These are compose-specific bulk operations, not generic per-component executor operations.

```typescript
interface DockerComposeOps {
  readonly build: (
    services: string[]
  ) => Effect<void, ExecutorError | BuildError>
  readonly stop: (services: string[]) => Effect<void, ExecutorError>
  readonly up: (
    opts: ComposeUpOpts
  ) => Effect<void, ExecutorError | DockerNotAvailableError>
  readonly isDockerRunning: Effect<boolean>
  readonly withOverride: (
    overrides: DerivedOverride[],
    envPath: string
  ) => DockerComposeOps
}
```

**Why both DockerComposeOps and DockerComposeExecutor?** `DockerComposeExecutor` implements the generic `Executor` — deploy/stop/inspect per component. `DockerComposeOps` handles compose-specific bulk operations (build N services, start with override files, stop remote deps during connection). The DependencyConnector uses `DockerComposeOps`; the reconciler uses `Executor`. `DockerComposeExecutorLive` internally delegates to `DockerComposeOps`.

**Four Executor layer implementations:**

1. **DockerComposeExecutorLive** — Deps: `SiteConfig`, `DockerComposeOps`. All `shellCapture` calls become `Effect.tryPromise` wrapped in `ExecutorError`.

2. **DevProcessExecutorLive** — Deps: `SiteConfig`, `SiteState`, `PortRegistry`, `ProcessManager`. Deploy flow: `detectServiceType` (pure function from `detect-service-type.ts`, not a service) → `allocatePort` → `buildDevCmd` → `spawn` → `updateComponentStatus`. Determines Node/Python/Java and builds the appropriate dev command.

3. **KubernetesExecutorLive** — Stub for now. All ops fail with `ExecutorError({ cause: "not yet implemented" })`.

4. **RoutingExecutorLive** — Routes by reading component mode from `SiteState` per-operation (not baked at construction). Deps: `SiteState`, `DockerComposeExecutor` (internal tag), `DevProcessExecutor` (internal tag). Delegation: `"native"` → DevProcessExecutor, `"container"` → DockerComposeExecutor, `"linked"/"service"` → synthetic state from SiteState. A component can switch executors mid-session.

### Layer 4 — Orchestration Services

**SiteReconciler** — Diff desired vs actual, topological ordering, execute steps. Plugs into the `ReconcilerRuntime` primitives now in `shared/`.

```typescript
interface SiteReconciler {
  readonly planChanges: (
    manifest: SiteManifest,
    actual: ComponentState[]
  ) => Effect<ReconcilePlan>
  readonly executeStep: (step: ReconcileStep) => Effect<void, ExecutorError>
  readonly reconcileOnce: (
    manifest: SiteManifest
  ) => Effect<ReconcileResult, ExecutorError>
  readonly reconcile: Effect<ReconcileResult, ExecutorError | ManifestError>
  readonly events: EventJournal<ReconcileEvent>
  readonly lastResult: Effect<ReconcileResult | null>
}
```

- `planChanges` and `topologicalOrder` stay as pure functions — no Effect needed, same as today's `reconcile.ts`.
- The reconcile loop becomes a `ReconcilerDef` with `Schedule.spaced(config.reconcileIntervalMs)`, `DeduplicatingQueue` keyed by component name, and `CircuitBreaker { threshold: 5, resetAfter: 1min }`.
- `events` uses `EventJournal<ReconcileEvent>` (the shared primitive) — replaces the 200-event array in `SiteController`.
- After each step, the reconciler **sets conditions on the component** (not just phase). Phase is derived from conditions.
- Each reconcile cycle carries a `reconciliationId` for event correlation.
- On deploy success: sets `{ type: "Deployed", status: "True" }` + updates `observedGeneration` to match `spec.generation`.

**HealthMonitor** — Runs actual probes, not just generic health checks. Wraps `HealthProbe` (shared primitive) with probe execution.

```typescript
interface HealthMonitor {
  readonly latest: Effect<HealthSnapshot | null>
  readonly changes: PubSub<HealthSnapshot>
  readonly fiber: Effect<never> // fork this in the daemon
}
```

Implementation:

- Reads probe configs from `SiteState` component specs
- Executes startup → liveness → readiness probes per component
- **Startup probe active**: suspends liveness checks until startup succeeds (or hits `failureThreshold`)
- **Liveness failure**: sets `{ type: "Healthy", status: "False", reason: "LivenessProbeFailed" }` → triggers component restart via `Executor.restart`
- **Readiness failure**: sets `{ type: "Ready", status: "False", reason: "ReadinessProbeFailed" }` → component stays up but marked not-ready
- Falls back to `Executor.healthCheckAll` for components without probe configs (backward compat)

**ControlPlaneLink** — Communication with the control plane (Factory API today, could be k8s API server tomorrow).

```typescript
interface ControlPlaneLink {
  readonly checkin: (
    payload: CheckinPayload
  ) => Effect<CheckinResponse, ControlPlaneLinkError>
  readonly fetchManifest: Effect<SiteManifest, ControlPlaneLinkError>
  readonly reportState: (
    states: ComponentState[],
    health: Record<string, string>
  ) => Effect<void, ControlPlaneLinkError>
  readonly checkForUpdates: (
    currentVersion: number,
    states: ComponentState[],
    executorType: string
  ) => Effect<SiteManifest | null, ControlPlaneLinkError>
}
```

Each call gets retry policy: `Schedule.exponential("1 second").pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(3)))` + `Effect.timeout(Duration.seconds(10))`.

Layers:

- `FactoryControlPlaneLinkLive` — connected mode. HTTP calls to Factory API.
- `ControlPlaneLinkNoop` — standalone/air-gapped. All ops succeed with empty data or no-op.

`reportState` is best-effort: `Effect.catchAll(() => Effect.void)` — reporting failures don't break the reconcile loop.

**GatewayReconciler** — Route/domain management.

Layers: `NoopGatewayReconcilerLive` (current default for Docker Compose), `TraefikGatewayReconcilerLive` (future, for production proxy hosts).

**DependencyConnector** — Connects components to external dependencies. Handles connection profiles, connect flags, remote dependency resolution, compose override writing.

```typescript
interface DependencyConnector {
  readonly resolve: (
    flags: ConnectionFlags
  ) => Effect<ConnectionResult | null, ConnectionError>
  readonly apply: (
    conn: ConnectionResult,
    envPath: string,
    dryRun: boolean
  ) => Effect<string[], ConnectionError>
  readonly restoreLocal: (envPath: string) => Effect<void>
}
```

Deps: `SiteState`, `SiteConfig`, `PortRegistry`, `DockerComposeOps`.

Absorbs: `resolveConnections()`, `applyConnections()`, `restoreLocalState()`, `writeComposeOverride()` from the old `site-orchestrator.ts`, plus logic from `parse-connect-flags.ts`.

**CrossSystemLinker** — Links components across system boundaries. Distinct from DependencyConnector: this handles multi-system composition via `x-dx.dependencies`, fetching endpoints from target sites, writing linked system deployments, merging cross-system env vars.

```typescript
interface CrossSystemLinker {
  readonly resolve: (opts: CrossSystemLinkOpts) => Effect<CrossSystemLink[]>
  readonly apply: (
    links: CrossSystemLink[],
    connectionEnv: Record<string, string>
  ) => Effect<Record<string, string>>
}
```

Deps: `SiteState`, `SiteConfig`.

Maps to: `linked-sd-resolver.ts` (already has its own test file: `linked-sd-resolver.test.ts`). The test file stays — it tests the pure functions that `CrossSystemLinkerLive` delegates to.

**TunnelManager** — Remote dev tunnel lifecycle. Scope-based cleanup.

```typescript
interface TunnelManager {
  readonly open: (opts: TunnelOpts) => Effect<TunnelInfo, TunnelError, Scope>
  readonly getState: Effect<TunnelState>
}
```

The `Scope` on `open` means the tunnel auto-closes when the daemon scope ends. The current callback-based event handling (`onRegistered`, `onReconnecting`, `onReconnected`, `onError`, `onClose`) becomes a `Stream<TunnelEvent>` that the `TunnelManager` publishes.

**BuildCache** — Docker build skip logic.

```typescript
interface BuildCache {
  readonly check: (
    catalog: CatalogSystem,
    services: string[]
  ) => Effect<BuildCheckResult>
  readonly record: (catalog: CatalogSystem, services: string[]) => Effect<void>
}
```

Maps to: `build-cache.ts` (already has test file: `build-cache.test.ts`). Pure functions today — thin Effect wrapper mainly for consistency, but could be enhanced with content-hash based invalidation later.

**DependencyGraph** — Not an Effect service (it's a pure data structure). Stays as imported from `@smp/factory-shared/dependency-graph`. Used by `DependencyConnector` and the dev session program for computing `transitiveDeps`.

**ServiceTypeDetector** — Not an Effect service (pure function). Stays as imported from `detect-service-type.ts`. Used internally by `DevProcessExecutorLive`.

### Layer 5 — Daemon

**AgentServer** — Elysia HTTP API bridged to Effect via `ManagedRuntime`.

```typescript
interface AgentServer {
  readonly start: Effect<{ port: number; stop: Effect<void> }, never, Scope>
}
```

Implementation: The Elysia app stays as-is (it's excellent at what it does). Each route handler calls `runtime.runPromise(effect)` using a `ManagedRuntime` created from the composed layer. Same pattern as `api/src/effect/bridge.ts`.

Key routes:

- `/health` → constant ok
- `/status` → reads from SiteState + HealthMonitor + EventJournal
- `/services` → Executor.inspect + SiteState component modes
- `/services/:name/logs/stream` → `Executor.logStream` piped to SSE
- `/events` → EventJournal.subscribe piped to SSE

---

## Part 3: Programs (Top-Level Compositions)

Programs are not services — nothing depends on them. They compose services and run fibers.

### DevPrelude — Foreground pre-daemon phase

The `dx dev` command runs significant interactive logic BEFORE spawning the daemon:

1. **Auto-connect resolution** (`autoConnectsFromDeps`) — computes implicit `--connect` flags from `x-dx.dependencies`
2. **Cached prelude** (`runPrelude`) — runs codegen, dep installs, etc. Interactive (may need stdin).
3. **Codegen** (`spawnSync` for each generator) — synchronous, must complete before daemon starts.

This phase is NOT effectified in this plan. It runs in the foreground CLI process (not the daemon), is interactive, and is relatively simple imperative code. It stays as-is. The daemon receives the resolved opts (components, connect flags, etc.) via the config JSON file.

**Why**: Effectifying the foreground CLI command logic is a separate concern from the daemon. The daemon is where the complexity, concurrency, and resource management live. The foreground phase is sequential setup. Mixing them would complicate the migration for no gain.

### DevSession program

```typescript
const devSession = Effect.scoped(Effect.gen(function* () {
  const config = yield* SiteConfig
  const siteState = yield* SiteState
  const portRegistry = yield* PortRegistry
  const executor = yield* Executor
  const composeOps = yield* DockerComposeOps
  const connResolver = yield* DependencyConnector
  const linkedSdResolver = yield* CrossSystemLinker
  const tunnelManager = yield* TunnelManager
  const buildCache = yield* BuildCache
  const healthMonitor = yield* HealthMonitor
  const agentServer = yield* AgentServer

  // 1. Reset intent (yesterday's flags don't leak)
  const savedStatuses = yield* siteState.resetIntent

  // 2. Port resolution
  const { envPath, allEnvVars } = yield* portRegistry.allocate(...)

  // 3. Connection resolution + apply
  const conn = yield* connResolver.resolve(config.connectionFlags)
  if (conn) yield* connResolver.apply(conn, envPath, false)

  // 4. Linked SD resolution
  const linkedSds = yield* linkedSdResolver.resolve(...)
  const crossSystemEnv = yield* linkedSdResolver.applyCrossSystemEnv(linkedSds, conn?.env ?? {})

  // 5. Set desired state in site.json (native for targets, container for deps)
  yield* Effect.forEach(targets, t => siteState.setComponentMode(sdSlug, t, "native"))
  yield* Effect.forEach(localDockerDeps, d => siteState.setComponentMode(sdSlug, d, "container"))

  // 6. Restore runtime status from prior run
  yield* Effect.forEach([...targets, ...localDockerDeps], c => siteState.restoreStatus(sdSlug, c, savedStatuses))

  // 7. Cleanup orphaned native processes
  yield* cleanupOrphanedProcesses(savedStatuses, liveComponents)

  // 8. Build check + start Docker deps
  const buildCheck = yield* buildCache.check(config.focusSystem.catalog, localDockerDeps)
  if (needsBuild.length > 0) yield* composeOps.build(needsBuild)
  if (localDockerDeps.length > 0) yield* composeOps.up({ detach: true, services: localDockerDeps, noBuild: true, noDeps: true })

  // 9. Start native dev servers via executor
  yield* Effect.forEach(targets, component =>
    executor.deploy(component, { image: "", replicas: 1, envOverrides, resourceOverrides: {} }),
    { concurrency: 1 }  // sequential for port binding stability
  )

  // 10. Open tunnel if requested
  if (config.tunnel) yield* tunnelManager.open(tunnelOpts)

  // 11. Fork health monitor
  yield* Effect.fork(healthMonitor.fiber)

  // 12. Start HTTP server
  yield* agentServer.start

  // 13. Save state + block
  yield* siteState.save
  yield* Effect.never  // scope finalizers handle shutdown
}))
```

### UpSession program

Simpler — all containers, no native processes, no connection resolution.

```typescript
const upSession = Effect.scoped(Effect.gen(function* () {
  const config = yield* SiteConfig
  const siteState = yield* SiteState
  const portRegistry = yield* PortRegistry
  const composeOps = yield* DockerComposeOps
  const healthMonitor = yield* HealthMonitor
  const agentServer = yield* AgentServer

  const savedStatuses = yield* siteState.resetIntent
  yield* cleanupOrphanedProcesses(savedStatuses, new Set())
  const { envPath } = yield* portRegistry.allocate(...)
  yield* Effect.forEach(allComponents, c => siteState.setComponentMode(sdSlug, c, "container"))
  yield* composeOps.up({ detach: true, noBuild: config.noBuild, profiles: config.profiles })
  yield* siteState.setPhase("running")
  yield* siteState.save
  yield* Effect.fork(healthMonitor.fiber)
  yield* agentServer.start
  yield* Effect.never
}))
```

### ControllerDaemon program

Continuous reconcile loop, Factory polling, health monitoring.

```typescript
const controllerDaemon = Effect.scoped(
  Effect.gen(function* () {
    const reconciler = yield* SiteReconciler
    const healthMonitor = yield* HealthMonitor
    const agentServer = yield* AgentServer

    // Create ReconcilerRuntime with site reconciler def
    const rt = yield* createReconcilerRuntime([siteReconcilerDef])

    yield* Effect.fork(rt.run)
    yield* Effect.fork(healthMonitor.fiber)
    yield* agentServer.start
    yield* Effect.never
  })
)
```

### AgentDaemon — unified entry point

Replaces `agent-daemon.ts`. Reads config, selects mode, composes the right layer, runs the program.

```typescript
const agentDaemon = Effect.gen(function* () {
  const config = yield* SiteConfig

  const program =
    config.mode === "controller"
      ? controllerDaemon
      : config.mode === "up"
        ? upSession
        : devSession

  yield* program
})

// Entry point
const layer =
  config.mode === "controller"
    ? createControllerLayer(opts)
    : config.mode === "up"
      ? createUpLayer(opts)
      : createDevLayer(opts)

Effect.runFork(agentDaemon.pipe(Effect.provide(layer)))
```

---

## Part 4: Runtime Composition by Mode

### Dev Mode layer

```
SiteConfigFromDaemonOpts
  → JsonFileStoreLive("site.json") → SiteStateLive
  → PortRegistryLive
  → ProcessManagerLive
  → DockerComposeOpsLive
  → DevProcessExecutorLive + DockerComposeExecutorLive → RoutingExecutorLive (provides Executor)
  → DependencyConnectorLive
  ��� CrossSystemLinkerLive
  → TunnelManagerLive
  → BuildCacheLive
  → HealthMonitorLive
  → EventJournalLive
  → AgentServerLive
```

### Up Mode layer

```
SiteConfigFromDaemonOpts
  → JsonFileStoreLive("site.json") → SiteStateLive
  → PortRegistryLive
  → DockerComposeOpsLive
  → DockerComposeExecutorLive (provides Executor — no native, no composite)
  → HealthMonitorLive
  → EventJournalLive
  → AgentServerLive
```

### Controller Mode layer

```
SiteConfigFromDaemonOpts
  → JsonFileStoreLive("site.json") → SiteStateLive
  → JsonFileStoreLive("controller-state.json") → ControllerStateStoreLive
  → DockerComposeOpsLive (or KubernetesOps in future)
  → DockerComposeExecutorLive (provides Executor)
  → ControlPlaneLinkLive (or ControlPlaneLinkNoop)
  → GatewayReconcilerLive (or NoopGatewayReconcilerLive)
  → SiteReconcilerLive
  → HealthMonitorLive
  → EventJournalLive
  → AgentServerLive
```

### One-shot CLI commands (dx dev start, dx dev ps, etc.)

These create a `SiteOrchestrator` for a single operation, not a daemon. In the Effect model, they compose a minimal layer (just `SiteConfig` + `SiteState` + `Executor`) and run a single effect, then exit. No daemon, no fibers, no HTTP server.

---

## Part 5: Design Perspectives

### System Architect view — Service contracts and extensibility

**Executor as the universal infrastructure interface.** The `Executor` tag defines: inspect, deploy, stop, scale, restart, healthCheck. This same interface can drive:

- Docker Compose (today)
- Kubernetes Deployments (planned)
- systemd services (production VMs)
- Cloud provider resources (ECS, Cloud Run)
- SSH + remote compose (multi-node cluster)

Each is a Layer implementation providing `Executor`. The reconciler, health monitor, and agent server don't know or care which runtime backs them. This is the key architectural invariant — keep it clean.

**DockerComposeOps as the escape hatch.** Not everything fits the Executor pattern. Compose-specific operations (build, override files, env files) go through `DockerComposeOps`. This is explicitly NOT part of the generic Executor contract. If we later need k8s-specific ops (helm install, CRD apply), that would be a `KubernetesOps` service — same pattern.

**ReconcilerRuntime as the standard loop.** Every system that needs desired-state reconciliation uses the same primitives: `ReconcilerDef` → `ReconcilerRuntime` with `DeduplicatingQueue` + `CircuitBreaker`. DNS sync already does this. Site controller will. Future k8s operators, certificate renewers, backup schedulers — all the same shape. By putting these in `shared/`, we establish this as the canonical pattern.

**State management model.** Three distinct coordination patterns:

1. **In-process** (`Ref<T>`) — fast reads within the daemon process. SiteState, HealthMonitor snapshot.
2. **File-based** (`JsonFileStore`) — persistence across restarts. site.json, agent.json, controller-state.json.
3. **API-based** — cross-process coordination. CLI subcommands hit the agent's HTTP API. Remote operations (`dx status --site factory-prod`) hit the Factory API.

The `Ref` and file store are unified in `JsonFileStore` — the Ref is the hot path, the file is the cold path. The API is a separate concern handled by `AgentServer`.

### DevOps view — Operational resilience

**Graceful shutdown via Effect Scope.** Every resource registers a finalizer. On SIGINT/SIGTERM:

1. HTTP server stops accepting connections (drains in-flight requests)
2. Tunnel closes
3. Native processes receive SIGTERM (via ProcessManager finalizers), escalate to SIGKILL after 2s
4. Docker compose stops (if appropriate for mode)
5. State files flushed
6. Agent state cleared

This is automatic — no manual `shutdownCallbacks` array to maintain. Adding a new resource type automatically participates in shutdown.

**Circuit breaker on reconciliation.** After 5 consecutive failures, the reconciler opens the circuit and stops hammering a broken system. Exponential backoff resets (1min → 2min → 4min → 10min max). This prevents a single broken component from cascading SIGTERM/SIGKILL storms on a production VM.

**Retry policies by tier:**

- Executor operations: no retry (fast-fail, let the reconciler re-attempt on next cycle)
- Factory link: 3 retries, exponential backoff 1s→2s→4s, jittered, 10s timeout
- Health checks: no retry (periodic schedule handles re-checks)
- File I/O (state persistence): 2 retries, 100ms delay (transient FS issues)

**Observability layers:**

- `EventJournal<ReconcileEvent>` — 200-event ring buffer, available via `/events` HTTP endpoint and SSE
- `PubSub<HealthSnapshot>` — real-time health changes, subscribers include agent server and factory link
- `Effect.logInfo/logError/logWarning` — structured logging with annotations (reconciler name, component, action)
- All errors carry structured metadata (component, executor type, operation) for log aggregation

**Production VM deployment pattern.** Controller mode on a production VM:

1. `dx setup --role site factory-prod` — writes site identity to `.dx/site.json`
2. `dx site start` — spawns daemon in controller mode
3. Daemon polls Factory API for desired manifest
4. CI pushes image → Factory updates `trackedImageRef` → next poll picks it up → reconcile deploys
5. `dx site stop` — SIGTERM to daemon, graceful shutdown

**Health endpoint contract.** `/api/v1/site/health` returns 200 immediately (before session starts), so the parent process can poll for liveness. `/api/v1/site/status` returns full state (mode, components, reconcile results, health snapshot). This separation means the daemon is "alive" as soon as the HTTP server starts, and "ready" once the session completes.

### Lead Engineer view — Migration strategy and risk

**Incremental migration, not big-bang.** The plan is structured so each phase ships independently and `dx dev` works after every step:

1. **Phase 1** (shared primitives): Pure additions, no existing code changes. Can be merged and used immediately by any part of the codebase.

2. **Phase 2** (state services): Effect services that _wrap_ existing classes. `SiteStateLive` internally creates a `SiteManager` and delegates. Existing code keeps working. New code can use either path.

3. **Phase 3** (executors): Same wrapping pattern. `DockerComposeExecutorLive` internally creates a `DockerComposeExecutor` instance. Tests for the imperative code keep passing.

4. **Phase 4** (orchestration): New services that compose the wrapped services. The `SiteReconciler` uses the Effect `Executor` service, which internally delegates to the imperative class.

5. **Phase 5** (programs): New entry points that use Effect composition. `agent-daemon.ts` gets an Effect-based alternative. Both paths coexist.

6. **Phase 6** (cutover): CLI commands switch from imperative path to Effect path. This is the risky step — but by now every service has been tested in isolation through the wrapping phase.

7. **Phase 7** (cleanup): Remove imperative class code, update exports, remove wrapping indirection.

**The key risk is Phase 6.** The `dx dev` command handler has 400+ lines with subcommands (`start`, `stop`, `ps`, `logs`), auto-connect, prelude, codegen, daemon spawn, health wait, log attach. Breaking this down:

- `dx dev` (main) → runs prelude (stays imperative), spawns daemon (now runs Effect program), waits for health, attaches to logs. Changes: daemon entry point only.
- `dx dev start <component>` → one-shot via agent HTTP API (no change needed — the API handler calls Effect internally)
- `dx dev stop` → SIGTERM to daemon (no change)
- `dx dev ps` → reads from agent HTTP API (no change)
- `dx dev logs` → streams from agent HTTP API (no change)

So the actual cutover for `dx dev` is just the daemon entry point (`agent-daemon.ts`). The CLI command handlers mostly talk to the daemon via HTTP — they don't need to change.

**Testing strategy:**

- **Existing tests preserved.** `build-cache.test.ts`, `linked-sd-resolver.test.ts`, `detect-service-type.test.ts`, `endpoint-resolver.test.ts` — these test pure functions that don't change.
- **Effect services tested via `Layer.succeed(testImpl)`.** Each service tag gets a test implementation that returns canned data. No mock library needed — Effect's service pattern IS the test double pattern.
- **Integration tested via `Effect.runPromise`.** Compose a minimal layer with test implementations, run the program, assert outcomes.
- **Smoke tests unchanged.** `dx dev` / `dx up` / `dx site start` work the same from the CLI user's perspective. The daemon just runs Effect internally.

**Bundle size / perf impact:** Effect is already a dependency (`effect: 3.21.1`). No new packages. The `@effect/platform` package is already in the CLI. The main perf concern is fiber scheduling overhead for health checks and reconcile loops — negligible compared to Docker/process operations.

---

## Part 6: Implementation Phases

### Phase 1: Shared Primitives

1. Move `api/src/effect/reconcile/*` → `shared/src/effect/reconcile/` (7 files)
2. Update `api/src/effect/reconcile/` to re-export from shared (backward compat)
3. Add export `"./effect/reconcile"` to shared package.json (already covered by wildcard)
4. Implement `JsonFileStore` in `shared/src/effect/json-file-store.ts`
5. Implement `ProcessManager` in `shared/src/effect/process-manager.ts`
6. Implement `HealthProbe` in `shared/src/effect/health-probe.ts`
7. Implement `PortRegistry` in `shared/src/effect/port-registry.ts`
8. Implement `EventJournal` in `shared/src/effect/event-journal.ts`
9. Tests for each primitive

### Phase 2: Error Types + Config

10. Define all site error types in `cli/src/effect/errors/site.ts`
11. Add site error tags to `cli/src/effect/bridge.ts` (`effectErrorToDxError`)
12. Create `SiteConfig` service + layer constructors
13. Create `WorkspaceDiscovery` service

### Phase 3: State Services (wrapping existing classes)

14. Create `SiteState` service wrapping `SiteManager`
15. Create `ControllerStateStore` service wrapping `StateStore`
16. Create `AgentStateStore` service wrapping agent-lifecycle functions

### Phase 4: Executors (wrapping existing classes)

17. Create `DockerComposeOps` service wrapping `Compose` class
18. Create `Executor` service tag
19. Implement `DockerComposeExecutorLive` wrapping `DockerComposeExecutor` class
20. Implement `DevProcessExecutorLive` wrapping `DevProcessExecutor` class
21. Implement `RoutingExecutorLive` wrapping `RoutingExecutor` class

### Phase 5: Orchestration Services

22. Create `SiteReconciler` service (wire into shared `ReconcilerRuntime`)
23. Create `HealthMonitor` service (using shared `HealthProbe`)
24. Create `ControlPlaneLink` service (with retry/timeout)
25. Create `GatewayReconciler` service
26. Create `DependencyConnector` service
27. Create `CrossSystemLinker` service
28. Create `TunnelManager` service
29. Create `BuildCache` service
30. Create `AgentServer` service (Elysia + ManagedRuntime bridge)

### Phase 6: Programs + Runtime Composition

31. Implement `devSession` program
32. Implement `upSession` program
33. Implement `controllerDaemon` program
34. Implement `createDevLayer`, `createUpLayer`, `createControllerLayer` in `cli/src/effect/runtime.ts`
35. Write Effect-based `agent-daemon.ts` alternative

### Phase 7: Cutover

36. Update `agent-daemon.ts` to use Effect program (dual path: env flag to switch)
37. Test all three modes end-to-end
38. Remove dual path, make Effect the default
39. Update one-shot CLI subcommand handlers that create `SiteOrchestrator` directly (for non-daemon paths like `--dry-run`)

### Phase 8: Cleanup

40. Remove wrapper indirection (SiteStateLive no longer wraps SiteManager — it IS the implementation)
41. Remove old class-based code (SiteOrchestrator, SiteController, SiteAgent classes)
42. Update `cli/src/effect/index.ts` exports

---

## Deprecated Code to Remove

This is a fresh start. These files/patterns are eliminated entirely:

| File/Pattern                                | Why Removed                | Replaced By                                |
| ------------------------------------------- | -------------------------- | ------------------------------------------ |
| `cli/src/site/controller-server.ts`         | Already deprecated         | `AgentServer` service                      |
| `cli/src/site/start.ts`                     | Legacy controller startup  | `controllerDaemon` program                 |
| `cli/src/lib/site-orchestrator.ts`          | 49KB god class             | Decomposed into 7 services + 3 programs    |
| `cli/src/site/agent.ts` (`SiteAgent` class) | Manual lifecycle           | Effect programs with Scope                 |
| `shutdownCallbacks[]` pattern               | Error-prone manual cleanup | Effect Scope finalizers                    |
| `setInterval` loops                         | Not interruptible          | `Effect.repeat` + `Schedule.spaced` fibers |
| `Atomics.wait` busy-loop                    | Blocks the thread          | `Effect.sleep` + `Effect.retry`            |
| `migrateV1()` in SiteManager                | V1 site.json format        | Clean break                                |
| `controller.pid` file                       | Redundant with agent.json  | `AgentStateStore`                          |

## File Layout

Filenames match their service. No legacy names.

```
shared/src/effect/
  reconcile/                       ← moved from api/src/effect/reconcile/
    diff-sets.ts
    reconcile-set.ts
    reconciler.ts
    runtime.ts
    dedup-queue.ts
    circuit-breaker.ts
    index.ts
  json-file-store.ts               ← generic atomic JSON persistence
  process-manager.ts               ← generic child process lifecycle
  health-probe.ts                  ← generic periodic health + PubSub
  port-registry.ts                 ← generic port allocation
  event-journal.ts                 ← generic bounded event ring buffer

api/src/effect/reconcile/          ← re-exports from shared (backward compat)

cli/src/effect/
  errors/
    site.ts                        ← all tagged errors with ErrorSuggestion[]
  services/
    site-config.ts                 ← SiteConfig tag
    workspace-discovery.ts         ← WorkspaceDiscovery tag
    site-state.ts                  ← SiteState tag
    controller-state-store.ts      ← ControllerStateStore tag
    agent-state-store.ts           ← AgentStateStore tag
    docker-compose-ops.ts          ← DockerComposeOps tag
    executor.ts                    ← Executor tag (with runProbe, logStream)
    site-reconciler.ts             ← SiteReconciler tag (conditions-driven)
    health-monitor.ts              ← HealthMonitor tag (probe execution)
    control-plane-link.ts          ← ControlPlaneLink tag
    gateway-reconciler.ts          ← GatewayReconciler tag
    dependency-connector.ts        ← DependencyConnector tag
    cross-system-linker.ts         ← CrossSystemLinker tag
    tunnel-manager.ts              ← TunnelManager tag
    build-cache.ts                 ← BuildCache tag
    agent-server.ts                ← AgentServer tag
  layers/
    site-config.ts                 ← SiteConfigFromDaemonOpts, SiteConfigFromCli, SiteConfigFromEnv
    site-state.ts                  ← SiteStateLive
    controller-state-store.ts      ← ControllerStateStoreLive
    agent-state-store.ts           ← AgentStateStoreLive
    docker-compose-ops.ts          ← DockerComposeOpsLive
    executor/
      docker-compose.ts            ← DockerComposeExecutorLive
      dev-process.ts               ← DevProcessExecutorLive
      kubernetes.ts                ← KubernetesExecutorLive
      routing.ts                 ��� RoutingExecutorLive
    site-reconciler.ts             ← SiteReconcilerLive
    health-monitor.ts              ← HealthMonitorLive
    control-plane-link.ts          ← FactoryControlPlaneLinkLive, ControlPlaneLinkNoop
    gateway-reconciler.ts          ← NoopGatewayReconcilerLive
    dependency-connector.ts        ← DependencyConnectorLive
    cross-system-linker.ts         ← CrossSystemLinkerLive
    tunnel-manager.ts              ← TunnelManagerLive
    build-cache.ts                 ← BuildCacheLive
    agent-server.ts                ← AgentServerLive
  programs/
    dev-session.ts                 ← dx dev daemon program
    up-session.ts                  ← dx up daemon program
    controller.ts                  ← controller daemon program
    agent.ts                       ← unified entry point (mode → layer → program)
  runtime.ts                       ← createDevLayer, createUpLayer, createControllerLayer
  index.ts                         ← public API
```

---

## Critical Files

### Modify

| File                            | What Changes                                  |
| ------------------------------- | --------------------------------------------- |
| `shared/src/effect/index.ts`    | Add exports for new primitives                |
| `api/src/effect/reconcile/*.ts` | Become re-exports from shared                 |
| `cli/src/effect/bridge.ts`      | Add site error tags to `effectErrorToDxError` |
| `cli/src/effect/index.ts`       | Export new services, layers, programs         |
| `cli/src/site/agent-daemon.ts`  | Dual-path: Effect program or legacy           |

### Wrap (Phase 3-4, then replace in Phase 8)

| File                                  | Wrapped By                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `cli/src/lib/site-manager.ts`         | `SiteStateLive`                                                                                 |
| `cli/src/site/state.ts`               | `ControllerStateStoreLive`                                                                      |
| `cli/src/site/agent-lifecycle.ts`     | `AgentStateStoreLive`                                                                           |
| `cli/src/lib/port-manager.ts`         | Uses shared `PortRegistry`                                                                      |
| `cli/src/site/execution/compose.ts`   | `DockerComposeExecutorLive` + `DockerComposeOpsLive`                                            |
| `cli/src/site/execution/native.ts`    | `DevProcessExecutorLive` + shared `ProcessManager`                                              |
| `cli/src/site/execution/composite.ts` | `RoutingExecutorLive`                                                                           |
| `cli/src/site/controller.ts`          | `SiteReconcilerLive`                                                                            |
| `cli/src/site/health.ts`              | `HealthMonitorLive`                                                                             |
| `cli/src/site/factory-link.ts`        | `ControlPlaneLinkLive`                                                                          |
| `cli/src/site/gateway.ts`             | `NoopGatewayReconcilerLive`                                                                     |
| `cli/src/lib/site-orchestrator.ts`    | Decomposes into DependencyConnector + CrossSystemLinker + TunnelManager + BuildCache + programs |
| `cli/src/site/agent.ts`               | Replaced by programs/agent.ts                                                                   |
| `cli/src/site/agent-server.ts`        | `AgentServerLive`                                                                               |

### Read-only dependencies (unchanged)

| File                                   | Used By                                         |
| -------------------------------------- | ----------------------------------------------- |
| `cli/src/site/reconcile.ts`            | `SiteReconcilerLive` (pure functions stay pure) |
| `cli/src/site/manifest.ts`             | `SiteReconcilerLive`, `ControllerStateStore`    |
| `cli/src/lib/detect-service-type.ts`   | `DevProcessExecutorLive`                        |
| `cli/src/lib/build-cache.ts`           | `BuildCacheLive`                                |
| `cli/src/lib/linked-sd-resolver.ts`    | `CrossSystemLinkerLive`                         |
| `cli/src/lib/tunnel-client.ts`         | `TunnelManagerLive`                             |
| `cli/src/lib/endpoint-resolver.ts`     | `DependencyConnectorLive`                       |
| `@smp/factory-shared/dependency-graph` | Programs (transitiveDeps)                       |

---

## Verification

### Per-phase gates (must pass before proceeding)

**Phase 1**: `pnpm --filter @smp/factory-shared test` passes. `pnpm --filter @smp/factory-api test` passes (re-exports work). New primitives have unit tests.

**Phase 2-4**: `pnpm --filter lepton-dx exec tsgo --noEmit` passes. Wrapped services have tests showing identical behavior to the classes they wrap.

**Phase 5**: Each orchestration service tested in isolation with `Layer.succeed` test doubles.

**Phase 6**: All three programs (`devSession`, `upSession`, `controllerDaemon`) run under `Effect.runPromise` with test layers.

**Phase 7**: End-to-end smoke tests:

- `dx dev` — start site with native + container components, verify ports resolve, processes spawn, health checks work, Ctrl+C cleans up all processes
- `dx up` — all-container mode, compose up/down lifecycle
- `dx site start --standalone` — controller mode, reconcile loop runs, recovers from executor errors
- `dx dev stop` — SIGTERM, verify graceful shutdown (native processes killed, compose stopped, state cleared)

**Phase 8**: `pnpm --filter lepton-dx test` passes. No references to removed classes. Bundle size unchanged or smaller.

### Error propagation chain

Verify typed errors flow: Effect service → `ExecutorError` → `runEffect()` → `effectErrorToDxError()` → `DxError` → CLI renderer with suggestions. Test with: Docker not running, port conflict, component not found, Factory API unreachable.
