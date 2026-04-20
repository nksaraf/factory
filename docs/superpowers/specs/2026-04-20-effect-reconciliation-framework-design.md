# Effect-Native Reconciliation Framework

**Date:** 2026-04-20
**Status:** Design
**Supersedes:** Unified Controller Abstraction plan (reconcileSet + Controller + ControllerRunner)

## Context

Factory has ~11 reconciliation patterns spread across the codebase — a main `Reconciler` class, 4 periodic sync loops, a scan reconciler, an inventory reconciler, a DNS sync program, a site reconciler, a CLI reconciler, and route sync. They all follow Kubernetes-inspired principles (spec/status, generation tracking, level-triggered) but are implemented ad-hoc with different error handling, different scheduling, and different approaches to the same fundamental operation: _make observed state converge toward desired state_.

Effect-TS is already mature in the codebase (v3.21.1, 6+ services, proper layers, typed errors). The DNS sync program proves the Effect pattern works for reconciliation. This design extends that pattern into a universal framework.

**Goal:** A single `Reconciler` concept powered by Effect that every reconciliation pattern in the codebase can adopt, with typed errors, structured concurrency, built-in circuit breaking, and a clean scope/trigger model.

---

## Architecture

Four primitives at three levels:

```
Level 0 (Pure):    diffSets()            — pure function, no Effect, no I/O
Level 1 (Effect):  reconcileSet()        — Effect combinator, applies a diff with handlers
Level 2 (Framework): Reconciler.make()   — unified reconciler definition
Level 3 (Runtime): ReconcilerRuntime     — runs all reconcilers as Fibers
```

Each level is independently useful. You can use `diffSets` in a unit test, `reconcileSet` in a one-off script, or the full `Reconciler.make` for a production reconciler. Higher levels compose lower levels — they don't replace them.

---

## 1. `diffSets` — Pure Set Diff

A pure function with no Effect dependency. Takes two arrays and a key function, returns the three-way diff.

```typescript
// api/src/effect/reconcile/diff-sets.ts

interface SetDiff<D, O> {
  readonly toCreate: ReadonlyArray<D>
  readonly toUpdate: ReadonlyArray<{
    readonly desired: D
    readonly observed: O
  }>
  readonly toOrphan: ReadonlyArray<O>
}

interface DiffSetsOptions<D, O> {
  readonly desired: ReadonlyArray<D>
  readonly observed: ReadonlyArray<O>
  readonly keyOfDesired: (d: D) => string
  readonly keyOfObserved: (o: O) => string
  readonly isEqual?: (d: D, o: O) => boolean // skip update when equal
}

function diffSets<D, O = D>(options: DiffSetsOptions<D, O>): SetDiff<D, O>
```

**Properties:**

- Pure — no side effects, no async, no Effect
- Deterministic — same inputs always produce same outputs
- `isEqual` is optional — when provided, matching pairs where `isEqual` returns `true` appear in neither `toUpdate` nor any other category (they're converged, skip them)
- Duplicate keys in `desired`: last occurrence wins (Map semantics)
- Testable with plain `expect()` — no Effect runtime needed

**Implementation sketch:**

```typescript
function diffSets<D, O = D>(options: DiffSetsOptions<D, O>): SetDiff<D, O> {
  const desiredByKey = new Map<string, D>()
  for (const item of options.desired) {
    desiredByKey.set(options.keyOfDesired(item), item)
  }

  const observedByKey = new Map<string, O>()
  for (const item of options.observed) {
    observedByKey.set(options.keyOfObserved(item), item)
  }

  const toCreate: D[] = []
  const toUpdate: Array<{ desired: D; observed: O }> = []
  const toOrphan: O[] = []

  for (const [key, desired] of desiredByKey) {
    const observed = observedByKey.get(key)
    if (observed === undefined) {
      toCreate.push(desired)
    } else if (!options.isEqual?.(desired, observed)) {
      toUpdate.push({ desired, observed })
    }
    // else: equal, skip
  }

  for (const [key, observed] of observedByKey) {
    if (!desiredByKey.has(key)) {
      toOrphan.push(observed)
    }
  }

  return { toCreate, toUpdate, toOrphan }
}
```

---

## 2. `reconcileSet` — Effect Combinator

Wraps `diffSets` with effectful handlers. Runs handlers with bounded concurrency. Catches per-item errors and accumulates them in the result.

```typescript
// api/src/effect/reconcile/reconcile-set.ts

interface ReconcileSetOptions<D, O, E, R> {
  readonly desired: ReadonlyArray<D>
  readonly observed: ReadonlyArray<O>
  readonly keyOfDesired: (d: D) => string
  readonly keyOfObserved: (o: O) => string
  readonly isEqual?: (d: D, o: O) => boolean
  readonly onCreate: (item: D) => Effect.Effect<void, E, R>
  readonly onUpdate: (desired: D, observed: O) => Effect.Effect<void, E, R>
  readonly onOrphan: (item: O) => Effect.Effect<void, E, R>
  readonly concurrency?: number // default: 1
}

interface ReconcileSetResult {
  readonly created: number
  readonly updated: number
  readonly orphaned: number
  readonly skipped: number
  readonly errors: ReadonlyArray<{
    readonly key: string
    readonly phase: "create" | "update" | "orphan"
    readonly error: unknown
  }>
}

function reconcileSet<D, O, E, R>(
  options: ReconcileSetOptions<D, O, E, R>
): Effect.Effect<ReconcileSetResult, never, R>
```

**Key properties:**

- **Error channel is `never`.** Every handler error is caught and recorded in `result.errors`. The reconciliation always completes — you get a result with error details, not a failed Effect. This matches K8s: one failing entity doesn't stop the loop.
- **Concurrency is bounded.** `Effect.forEach` with `{ concurrency }` manages the fiber pool.
- **Order: create → update → orphan.** Creates run first (new entities may be needed by updates), then updates, then orphans. Within each phase, items are processed concurrently.
- **Mutable error accumulation is safe.** The `errors` array is pushed to from concurrent `Effect.forEach` fibers. This is safe because Effect fibers are cooperative on a single JS thread — `Effect.sync` callbacks never interleave. No `Ref` needed.
- **Tracing built-in.** The function is wrapped with `Effect.withSpan("reconcileSet")` and each phase gets a child span.

**Implementation sketch:**

```typescript
function reconcileSet<D, O, E, R>(
  options: ReconcileSetOptions<D, O, E, R>
): Effect.Effect<ReconcileSetResult, never, R> {
  return Effect.gen(function* () {
    const diff = diffSets({
      desired: options.desired,
      observed: options.observed,
      keyOfDesired: options.keyOfDesired,
      keyOfObserved: options.keyOfObserved,
      isEqual: options.isEqual,
    })

    const concurrency = options.concurrency ?? 1
    const errors: Array<{ key: string; phase: string; error: unknown }> = []

    const catchItem =
      <T>(
        phase: string,
        keyFn: (item: T) => string,
        handler: (item: T) => Effect.Effect<void, E, R>
      ) =>
      (item: T) =>
        handler(item).pipe(
          Effect.map(() => true),
          Effect.catchAll((error) =>
            Effect.sync(() => {
              errors.push({ key: keyFn(item), phase, error })
              return false
            })
          )
        )

    const createResults = yield* Effect.forEach(
      diff.toCreate,
      catchItem("create", options.keyOfDesired, options.onCreate),
      { concurrency }
    )

    const updateResults = yield* Effect.forEach(
      diff.toUpdate,
      catchItem(
        "update",
        (pair) => options.keyOfDesired(pair.desired),
        (pair) => options.onUpdate(pair.desired, pair.observed)
      ),
      { concurrency }
    )

    const orphanResults = yield* Effect.forEach(
      diff.toOrphan,
      catchItem("orphan", options.keyOfObserved, options.onOrphan),
      { concurrency }
    )

    const skipped =
      options.desired.length - diff.toCreate.length - diff.toUpdate.length

    return {
      created: createResults.filter(Boolean).length,
      updated: updateResults.filter(Boolean).length,
      orphaned: orphanResults.filter(Boolean).length,
      skipped,
      errors,
    }
  }).pipe(Effect.withSpan("reconcileSet"))
}
```

---

## 3. `ReconcilerDef` — The Unified Concept

Every reconciler in the system — whether it syncs from an external provider, converges K8s state, or resolves DB routes — is the same type: `ReconcilerDef`.

### Core Type

```typescript
// api/src/effect/reconcile/reconciler.ts

interface ReconcilerDef<Params, E, R> {
  readonly name: string
  readonly schedule: Schedule.Schedule<unknown>

  /** Extract deduplication key from params. */
  readonly keyOf: (params: Params) => string

  /** Discover work items. Called on each schedule tick. */
  readonly scope: Effect.Effect<ReadonlyArray<Params>, E, R>

  /** Process one work item. */
  readonly reconcileOne: (params: Params) => Effect.Effect<void, E, R>

  /** Max concurrent reconcileOne calls. Default: 1. */
  readonly concurrency?: number

  /** Pre-delete cleanup. Return true to allow deletion. */
  readonly finalize?: (key: string) => Effect.Effect<boolean, E, R>

  /** Max retries for a single reconcileOne failure. Default: 3. */
  readonly maxRetries?: number

  /** Retry schedule for transient failures. Default: exponential(1s) with jitter. */
  readonly retrySchedule?: Schedule.Schedule<unknown>

  /** Circuit breaker config. Default: { threshold: 5, resetAfter: 1 minute }. */
  readonly circuitBreaker?: {
    readonly threshold: number
    readonly resetAfter: Duration.Duration
  }
}
```

### Generic `Params`

Every reconciler takes `Params`. This is the work item — it could be a simple string ID, or a rich object with pre-fetched data.

`keyOf` extracts a string key from `Params` for deduplication. If the same key is already in the queue, re-enqueuing is a no-op.

Two paths provide params:

1. **Schedule tick** → `scope()` returns `Params[]` → each is enqueued
2. **External trigger** → `runtime.enqueue(reconciler, params)` → enqueued directly

The reconciler doesn't know or care which path provided the params.

### Convenience Constructor

```typescript
const Reconciler = {
  make: <Params, E, R>(
    config: ReconcilerDef<Params, E, R>
  ): ReconcilerDef<Params, E, R> => config,
}
```

This is intentionally thin. There's ONE constructor, not three. Common patterns (entity reconciliation, set sync) are just patterns — they use `diffSets`/`reconcileSet` inside `reconcileOne`. The framework doesn't need separate constructors for them.

---

## 4. Examples — What Reconcilers Look Like

### 4a. Route Reconciler (DB-only, simplest)

```typescript
export const routeReconciler = Reconciler.make<string, DatabaseError, Db>({
  name: "route",
  schedule: Schedule.spaced("10 seconds"),
  keyOf: (routeId) => routeId,
  concurrency: 10,

  scope: Effect.gen(function* () {
    const db = yield* Db
    const stale = yield* query(
      db
        .select({ id: route.id })
        .from(route)
        .where(
          or(
            ne(route.generation, route.observedGeneration),
            sql`${route.status}->>'phase' IN ('pending', 'stale', 'error')`
          )
        )
    )
    return stale.map((r) => r.id)
  }),

  reconcileOne: (routeId) =>
    Effect.gen(function* () {
      const db = yield* Db
      const [r] = yield* query(
        db.select().from(route).where(eq(route.id, routeId))
      )
      if (!r) return

      const resolved = yield* Effect.tryPromise({
        try: () =>
          resolveRouteTargets(r.spec?.targets ?? [], drizzleDbReader(db)),
        catch: classifyDatabaseError,
      })

      yield* query(
        db
          .update(route)
          .set({
            status: resolved as Record<string, unknown>,
            observedGeneration: r.generation,
            updatedAt: new Date(),
          })
          .where(eq(route.id, routeId))
      )
    }).pipe(
      Effect.withSpan("reconciler.route.one", { attributes: { routeId } })
    ),
})
```

### 4b. Workload Reconciler (spec → runtime strategy, external system)

```typescript
interface WorkloadParams {
  cdId: string
  // When triggered by a deploy action, the spec is pre-loaded
  preloadedSpec?: ComponentDeploymentSpec
}

export const workloadReconciler = Reconciler.make<
  WorkloadParams,
  DatabaseError | KubeError,
  Db | KubeClient
>({
  name: "workload",
  schedule: Schedule.spaced("30 seconds"),
  keyOf: (p) => p.cdId,
  concurrency: 5,
  circuitBreaker: { threshold: 3, resetAfter: Duration.minutes(2) },

  scope: Effect.gen(function* () {
    const db = yield* Db
    const all = yield* query(db.select().from(componentDeployment))
    return all
      .filter((cd) => cd.status?.phase !== "stopped")
      .map((cd) => ({ cdId: cd.id }))
  }),

  reconcileOne: (params) =>
    Effect.gen(function* () {
      const db = yield* Db
      const kube = yield* KubeClient

      const [cd] = yield* queryOrNotFound(
        db
          .select()
          .from(componentDeployment)
          .where(eq(componentDeployment.id, params.cdId)),
        "component-deployment",
        params.cdId
      )

      const spec = params.preloadedSpec ?? (cd.spec as ComponentDeploymentSpec)
      if (!spec.desiredImage || spec.mode === "linked") return

      const ctx = yield* buildReconcileContext(db, cd)
      const strategy = getReconcilerStrategy(ctx.target.runtime)
      const result = yield* Effect.tryPromise({
        try: () => strategy.reconcile(ctx, db),
        catch: (e) => new KubeError({ message: String(e) }),
      })

      yield* query(
        db
          .update(componentDeployment)
          .set({
            status: {
              phase: result.status === "completed" ? "running" : result.status,
              driftDetected: result.driftDetected,
              lastReconciledAt: new Date(),
            },
            observedGeneration: cd.generation,
            updatedAt: new Date(),
          })
          .where(eq(componentDeployment.id, params.cdId))
      )
    }).pipe(
      // Typed error routing: connection errors retry, auth errors don't
      Effect.retry({
        while: (e) => e._tag === "KubeConnectionError",
        schedule: Schedule.exponential("2 seconds").pipe(Schedule.recurs(2)),
      }),
      Effect.withSpan("reconciler.workload.one")
    ),

  finalize: (cdId) =>
    Effect.gen(function* () {
      const kube = yield* KubeClient
      yield* kube.deleteNamespace(`workload-${cdId}`)
      return true
    }),
})
```

### 4c. Host Scan Sync (external discovery → ontology entities)

```typescript
interface HostScanParams {
  hostId: string
  hostSlug: string
  scanResult?: HostScanResult // optional: pre-fetched by CLI
}

export const hostScanSync = Reconciler.make<
  HostScanParams,
  DatabaseError | ScanError,
  Db | HostScanner
>({
  name: "host-scan",
  schedule: Schedule.spaced("5 minutes"),
  keyOf: (p) => p.hostId,
  concurrency: 3,
  circuitBreaker: { threshold: 3, resetAfter: Duration.minutes(5) },

  scope: Effect.gen(function* () {
    const db = yield* Db
    const hosts = yield* query(
      db
        .select({ id: host.id, slug: host.slug })
        .from(host)
        .where(sql`${host.spec}->>'lifecycle' = 'active'`)
    )
    return hosts.map((h) => ({ hostId: h.id, hostSlug: h.slug }))
  }),

  reconcileOne: (params) =>
    Effect.gen(function* () {
      const db = yield* Db
      const scanner = yield* HostScanner

      // Use pre-fetched scan data if available, otherwise scan
      const scan = params.scanResult ?? (yield* scanner.scan(params.hostId))

      // Build desired entities from scan
      const desired = scan.services.map((svc) => ({
        slug: `${params.hostSlug}-${slugify(svc.name)}`,
        name: svc.displayName ?? svc.name,
        type: "service" as const,
        spec: {
          ports: svc.ports.map((p) => ({
            name: `port-${p}`,
            port: p,
            protocol: "tcp",
          })),
          image: svc.image,
        },
        metadata: {
          annotations: { discoveredBy: "scan", hostSlug: params.hostSlug },
        },
      }))

      // Fetch observed entities from DB
      const observed = yield* query(
        db
          .select()
          .from(component)
          .where(
            sql`${component.metadata}->'annotations'->>'discoveredBy' = 'scan'
              AND ${component.metadata}->'annotations'->>'hostSlug' = ${params.hostSlug}`
          )
      )

      // reconcileSet does the work
      const result = yield* reconcileSet({
        desired,
        observed,
        keyOfDesired: (e) => e.slug,
        keyOfObserved: (e) => e.slug,
        isEqual: (d, o) => JSON.stringify(d.spec) === JSON.stringify(o.spec),

        onCreate: (entity) =>
          query(db.insert(component).values({ id: newId("cmp"), ...entity })),

        onUpdate: (desired, observed) =>
          query(
            db
              .update(component)
              .set({
                spec: desired.spec,
                metadata: desired.metadata,
                updatedAt: new Date(),
              })
              .where(eq(component.id, observed.id))
          ),

        onOrphan: (entity) =>
          query(
            db
              .update(component)
              .set({ lifecycle: "decommissioned", updatedAt: new Date() })
              .where(eq(component.id, entity.id))
          ),

        concurrency: 10,
      })

      if (result.errors.length > 0) {
        yield* Effect.logWarning("Partial scan sync failure", {
          hostId: params.hostId,
          errors: result.errors.length,
          created: result.created,
          orphaned: result.orphaned,
        })
      }
    }).pipe(Effect.withSpan("reconciler.host-scan.one")),
})
```

### 4d. Identity Sync (multi-provider, concurrent fetch)

```typescript
export const identitySync = Reconciler.make<
  string, // provider ID
  DatabaseError | SecretDecryptionError | ExternalServiceError,
  Db | SpecResolver
>({
  name: "identity",
  schedule: Schedule.spaced("30 minutes").pipe(Schedule.jittered),
  keyOf: (providerId) => providerId,
  concurrency: 3,

  scope: Effect.gen(function* () {
    const db = yield* Db
    const providers = yield* query(
      db
        .select({ id: gitHostProvider.id })
        .from(gitHostProvider)
        .where(eq(gitHostProvider.status, "active"))
    )
    return providers.map((p) => p.id)
  }),

  reconcileOne: (providerId) =>
    Effect.gen(function* () {
      const db = yield* Db
      const specResolver = yield* SpecResolver

      // Fetch users from external provider
      const providerUsers = yield* fetchProviderUsers(providerId, specResolver)

      // Fetch existing principals linked to this provider
      const existingPrincipals = yield* query(
        db
          .select()
          .from(principal)
          .where(
            sql`${principal.metadata}->'annotations'->>'linkedProvider' = ${providerId}`
          )
      )

      yield* reconcileSet({
        desired: providerUsers,
        observed: existingPrincipals,
        keyOfDesired: (u) => u.email,
        keyOfObserved: (p) => p.slug, // email is the slug
        isEqual: (d, o) => d.profileHash === (o.spec as any)?.profileHash,

        onCreate: (user) =>
          query(
            db.insert(principal).values({
              id: newId("ppl"),
              slug: user.email,
              name: user.name,
              type: "user",
              spec: { profileHash: user.profileHash, ...user.profile },
              metadata: { annotations: { linkedProvider: providerId } },
            })
          ),

        onUpdate: (desired, observed) =>
          query(
            db
              .update(principal)
              .set({
                spec: {
                  ...(observed.spec as object),
                  profileHash: desired.profileHash,
                  ...desired.profile,
                },
                updatedAt: new Date(),
              })
              .where(eq(principal.id, observed.id))
          ),

        onOrphan: (p) =>
          query(
            db
              .update(principal)
              .set({
                spec: sql`${principal.spec} || '{"deactivated": true}'::jsonb`,
                updatedAt: new Date(),
              })
              .where(eq(principal.id, p.id))
          ),

        concurrency: 5,
      })
    }).pipe(Effect.withSpan("reconciler.identity.one")),
})
```

---

## 5. `ReconcilerRuntime` — The Orchestrator

Manages all reconcilers as concurrent Fibers with structured concurrency.

### Interface

```typescript
// api/src/effect/reconcile/runtime.ts

interface ReconcilerRuntime {
  /** Run all reconcilers. Returns Effect<never> — runs until interrupted. */
  readonly run: Effect.Effect<never, never, R>

  /** Enqueue a typed work item for a specific reconciler. */
  readonly enqueue: <P>(
    reconciler: ReconcilerDef<P, any, any>,
    params: P
  ) => Effect.Effect<boolean> // false if already queued (deduped)

  /** Enqueue by name with untyped params (for API endpoints). */
  readonly triggerByName: (
    name: string,
    params: unknown
  ) => Effect.Effect<boolean>

  /** Re-run scope for a reconciler and process all discovered items. */
  readonly triggerAll: (name: string) => Effect.Effect<void>

  /** Health/status of all reconcilers. */
  readonly status: Effect.Effect<ReadonlyArray<ReconcilerStatus>>
}

interface ReconcilerStatus {
  readonly name: string
  readonly circuit: "closed" | "open" | "half-open"
  readonly consecutiveFailures: number
  readonly lastRunAt: Date | null
  readonly lastResult: { processed: number; errors: number } | null
  readonly queueDepth: number
  readonly nextRunAt: Date | null
}
```

### Internal Architecture

```
ReconcilerRuntime.make(reconcilers)
  │
  ├── For each reconciler:
  │     ├── DeduplicatingQueue<Params>  (bounded, key-based dedup)
  │     ├── CircuitBreaker state (Ref<CircuitState>)
  │     ├── Schedule fiber: Effect.repeat(scopeTick, schedule)
  │     └── Worker fiber: drain queue → reconcileOne per item
  │
  ├── Structured concurrency:
  │     All fibers are children of the runtime fiber.
  │     When runtime is interrupted, all children are interrupted.
  │
  └── Metrics fiber: periodically emit gauge metrics for all reconcilers
```

### DeduplicatingQueue

A thin wrapper over Effect's `Queue.bounded` that tracks in-flight keys:

```typescript
interface DeduplicatingQueue<P> {
  readonly offer: (params: P) => Effect.Effect<boolean>
  readonly take: Effect.Effect<P>
  readonly size: Effect.Effect<number>
  readonly complete: (key: string) => Effect.Effect<void> // remove from dedup set
}

function makeDeduplicatingQueue<P>(
  capacity: number,
  keyOf: (p: P) => string
): Effect.Effect<DeduplicatingQueue<P>, never, Scope.Scope>
```

When `offer` is called:

1. Extract key via `keyOf`
2. If key is in the dedup `HashSet`, return `false` (already queued)
3. Otherwise, add to set and offer to underlying queue

When `complete` is called (after `reconcileOne` finishes):

1. Remove key from dedup set
2. The same key can now be re-enqueued

### Circuit Breaker

Built into the runtime, not the reconciler. State tracked per-reconciler via `Ref<CircuitState>`:

```typescript
interface CircuitState {
  readonly status: "closed" | "open" | "half-open"
  readonly consecutiveAllFailureTicks: number
  readonly currentResetAfter: Duration.Duration
  readonly openedAt: number | null
}
```

**State transitions:**

| From      | Condition                                 | To        | Action                               |
| --------- | ----------------------------------------- | --------- | ------------------------------------ |
| closed    | N consecutive ticks where ALL keys failed | open      | Log warning, set condition           |
| open      | resetAfter duration elapsed               | half-open | Allow 1 key through                  |
| half-open | test key succeeds                         | closed    | Reset all counters                   |
| half-open | test key fails                            | open      | Double resetAfter (capped at 10 min) |
| any       | any key succeeds                          | closed    | Reset consecutive failure count      |

**"All keys failed"** means: scope returned >0 keys AND every `reconcileOne` call failed. If scope returns 0 keys, that's not a failure — there's just nothing to do.

### Startup

```typescript
// In api/src/effect/programs/reconciler-runtime.ts

// R is the union of all reconciler requirements — the caller provides layers.
// Reconciler type params are erased at the runtime boundary (stored as any).
// Type safety is enforced when each reconciler is defined, not at registration.
export function createReconcilerRuntime<R>(
  reconcilers: ReconcilerDef<any, any, R>[]
): Effect.Effect<ReconcilerRuntime, never, Scope.Scope | R> {
  return Effect.gen(function* () {
    const queues = new Map<string, DeduplicatingQueue<any>>()
    const circuitStates = new Map<string, Ref.Ref<CircuitState>>()

    for (const r of reconcilers) {
      const q = yield* makeDeduplicatingQueue(1000, r.keyOf)
      queues.set(r.name, q)

      const cs = yield* Ref.make<CircuitState>({
        status: "closed",
        consecutiveAllFailureTicks: 0,
        currentResetAfter: r.circuitBreaker?.resetAfter ?? Duration.minutes(1),
        openedAt: null,
      })
      circuitStates.set(r.name, cs)
    }

    // Build runtime: enqueue pushes to queue, run forks schedule + worker fibers,
    // status reads Refs. Full implementation in api/src/effect/reconcile/runtime.ts.
    return runtime
  })
}
```

Usage at API startup:

```typescript
// api/src/factory.api.ts (or api/src/effect/programs/startup.ts)

const runtime =
  yield *
  createReconcilerRuntime([
    routeReconciler,
    workloadReconciler,
    hostScanSync,
    identitySync,
    dnsSyncReconciler,
    inventorySyncReconciler,
  ])

yield * runtime.run.pipe(Effect.forkDaemon)
```

---

## 6. Error Model

### Per-item isolation

Every `reconcileOne` call is wrapped:

```typescript
const processKey = (params: P) =>
  reconcileOne(params).pipe(
    // Retry transient failures
    Effect.retry(
      retrySchedule ??
        Schedule.exponential("1 second").pipe(
          Schedule.intersect(Schedule.recurs(maxRetries ?? 3)),
          Schedule.jittered
        )
    ),
    // After all retries: catch, log, record
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        yield* Effect.logError("reconcileOne failed after retries", {
          reconciler: name,
          key: keyOf(params),
          error,
        })
        return { ok: false as const, error }
      })
    ),
    // Always succeeds — errors are absorbed
    Effect.map(() => ({ ok: true as const })),
    Effect.withSpan(`reconciler.${name}.processKey`)
  )
```

### Scope failure

```typescript
const scopeTick = scope.pipe(
  Effect.flatMap((keys) =>
    Effect.forEach(keys, (k) => queue.offer(k), { concurrency: "unbounded" })
  ),
  Effect.catchAll((error) =>
    Effect.logError("scope failed, skipping tick", { reconciler: name, error })
  )
)
```

### Typed error routing in reconcileOne

Reconciler authors use `Effect.catchTag` or `Effect.retry({ while })` for typed handling:

```typescript
reconcileOne: (params) =>
  Effect.gen(function* () {
    const kube = yield* KubeClient
    yield* kube.apply(manifest)
  }).pipe(
    // Connection errors: retry (transient)
    Effect.retry({
      while: (e) => e._tag === "KubeConnectionError",
      schedule: Schedule.exponential("2 seconds").pipe(Schedule.recurs(2)),
    }),
    // Auth errors: don't retry (permanent)
    Effect.catchTag("KubeAuthError", (e) =>
      Effect.logError("Permanent auth error, not retrying", { error: e }),
    ),
  ),
```

### reconcileSet error accumulation

Within a set sync, `reconcileSet` catches per-item handler errors:

- All items are processed regardless of individual failures
- Errors are accumulated in `result.errors[]`
- The caller decides: fail the entire reconcileOne (triggers retry), or absorb (next scope tick catches remaining items)

### Error isolation guarantees

| Failure                          | Impact                                | Recovery                                                 |
| -------------------------------- | ------------------------------------- | -------------------------------------------------------- |
| `reconcileOne` fails for one key | One key fails, others continue        | Retry with backoff, then absorbed                        |
| `scope` fails                    | Entire tick skipped                   | Next schedule tick retries                               |
| `reconcileSet` handler fails     | One item in set fails, set continues  | Error in result, caller decides                          |
| Service dependency down          | `reconcileOne` fails with typed error | `catchTag` routes; circuit breaker trips after threshold |
| Unhandled defect (bug)           | Caught by Effect runtime              | Logged as defect, fiber continues                        |

---

## 7. Metrics & Observability

Built into the framework — every reconciler gets these automatically.

### Spans (OpenTelemetry)

```
reconciler.{name}.tick          — one schedule tick
  reconciler.{name}.scope       — scope discovery
  reconciler.{name}.processKey  — one key (repeated per key)
    reconcileSet                — if using set sync (nested)
```

### Counters

| Metric                     | Labels                              | Description                  |
| -------------------------- | ----------------------------------- | ---------------------------- |
| `reconciler.processed`     | `name`, `outcome` (success/failure) | Keys processed               |
| `reconciler.created`       | `name`                              | Entities created (set syncs) |
| `reconciler.updated`       | `name`                              | Entities updated             |
| `reconciler.orphaned`      | `name`                              | Entities orphaned            |
| `reconciler.errors`        | `name`, `error_tag`                 | Errors by type               |
| `reconciler.circuit_state` | `name`, `state`                     | Circuit breaker state gauge  |
| `reconciler.queue_depth`   | `name`                              | Current queue depth gauge    |

### Structured Logging

Every log line includes: `{ reconciler, key, attempt, circuit, duration }`.

---

## 8. Testing

### Test `diffSets` — pure, no Effect

```typescript
import { diffSets } from "../effect/reconcile/diff-sets"

it("identifies orphans", () => {
  const diff = diffSets({
    desired: [{ slug: "a" }],
    observed: [{ slug: "a" }, { slug: "b" }],
    keyOfDesired: (d) => d.slug,
    keyOfObserved: (o) => o.slug,
  })
  expect(diff.toOrphan).toEqual([{ slug: "b" }])
})
```

### Test `reconcileSet` — with test layer

```typescript
import { Effect, Layer } from "effect"
import { reconcileSet } from "../effect/reconcile/reconcile-set"

it("creates and orphans", async () => {
  const log: string[] = []

  const result = await Effect.runPromise(
    reconcileSet({
      desired: [{ slug: "new" }],
      observed: [{ slug: "old" }],
      keyOfDesired: (d) => d.slug,
      keyOfObserved: (o) => o.slug,
      onCreate: (d) => Effect.sync(() => log.push(`create:${d.slug}`)),
      onUpdate: () => Effect.void,
      onOrphan: (o) => Effect.sync(() => log.push(`orphan:${o.slug}`)),
    })
  )

  expect(log).toEqual(["create:new", "orphan:old"])
  expect(result.created).toBe(1)
  expect(result.orphaned).toBe(1)
})
```

### Test a reconciler — swap layers

```typescript
// Mock services
const TestDb = Layer.succeed(Db, mockDb)
const TestKube = Layer.succeed(KubeClient, mockKube)
const TestLayer = Layer.mergeAll(TestDb, TestKube)

it("reconciles a workload", async () => {
  const result = await Effect.runPromise(
    workloadReconciler
      .reconcileOne({ cdId: "cdp_test" })
      .pipe(Effect.provide(TestLayer))
  )
  // assert on mockKube.applyCalls, mockDb.updateCalls, etc.
})
```

### Test the runtime — integration

```typescript
it("processes scope and triggers", async () => {
  const runtime = await Effect.runPromise(
    createReconcilerRuntime([testReconciler]).pipe(Effect.provide(TestLayer))
  )

  await Effect.runPromise(runtime.enqueue(testReconciler, { id: "test-1" }))
  // await tick, assert results
})
```

---

## 9. File Structure

```
api/src/effect/reconcile/
├── diff-sets.ts              — pure diffSets function
├── reconcile-set.ts          — reconcileSet Effect combinator
├── reconciler.ts             — ReconcilerDef type + Reconciler.make constructor
├── runtime.ts                — ReconcilerRuntime + DeduplicatingQueue + CircuitBreaker
├── index.ts                  — public exports

api/src/effect/reconcilers/
├── route.ts                  — route reconciler
├── workload.ts               — workload reconciler
├── host-scan.ts              — host scan sync
├── identity.ts               — identity sync
├── dns-sync.ts               — DNS sync (migrated from programs/dns-sync.ts)
├── inventory.ts              — inventory sync
├── workbench.ts              — workbench reconciler
├── site.ts                   — site reconciler

api/src/__tests__/
├── diff-sets.test.ts         — pure function tests
├── reconcile-set.test.ts     — Effect combinator tests
├── reconciler-runtime.test.ts — runtime integration tests
├── route-reconciler.test.ts  — route reconciler tests
├── (etc. per reconciler)
```

---

## 10. Migration Path

**Phase 1: Primitives (no existing code changes)**

1. Implement `diffSets` + tests
2. Implement `reconcileSet` + tests
3. Implement `ReconcilerRuntime` (ReconcilerDef, DeduplicatingQueue, CircuitBreaker) + tests

**Phase 2: First reconciler (proof of concept)** 4. Extract route reconciler as `ReconcilerDef` — simplest, DB-only, no external system 5. Run alongside existing `Reconciler.reconcileRoutes()` — both active, compare results 6. Once validated, remove old `reconcileRoutes()` from `Reconciler` class

**Phase 3: Set syncs (highest value)** 7. Migrate DNS sync — already Effect-native, just needs `ReconcilerDef` wrapper 8. Migrate host scan sync — heavy `reconcileSet` user, validates the primitive 9. Migrate identity sync

**Phase 4: Entity reconcilers** 10. Migrate workload reconciler — requires `KubeClient` as Effect service 11. Migrate workbench reconciler — most complex, includes lifecycle + snapshots 12. Migrate site reconciler

**Phase 5: Remove old infrastructure** 13. Remove `Reconciler` class 14. Remove `OperationRunner` usage for reconcilers (keep for non-reconciler operations) 15. Remove individual sync loop files (`identity-sync-loop.ts`, `git-host-sync-loop.ts`, etc.)

Each phase is independently shippable. Phase 1 has zero risk (new code only). Phase 2 runs in parallel with the old code. Phases 3-4 are incremental migrations.

---

## 11. Relationship to Ontology Framework

The `defineReconciler` API described in `docs/architecture/ontology-framework.md` (with observe/desired/diff/converge) is a higher-level sugar that can be built ON TOP of `ReconcilerDef`. The ontology framework's reconciler is a `Reconciler.make` with a specific `reconcileOne` shape:

```typescript
// ontology-framework.md's defineReconciler is sugar over Reconciler.make
function defineReconciler(config) {
  return Reconciler.make({
    name: config.name,
    schedule: config.schedule,
    keyOf: (entity) => entity.id,
    scope: config.scope ?? defaultScope(config.kind),
    reconcileOne: (entity) =>
      Effect.gen(function* () {
        if (entity.deletionRequestedAt) {
          return yield* config.finalize?.(entity) ?? Effect.void
        }
        const observed = yield* config.observe(entity)
        const desired = config.desired(entity)
        const drift = config.diff(desired, observed)
        if (drift === null) return
        yield* config.converge(entity, drift, makeConvergeContext(entity))
      }),
  })
}
```

This means the ontology framework can use this reconciliation layer as its foundation without any conflict. The framework adds domain-specific sugar (conditions, connectors, finalizers as entity annotations) on top.

---

## Verification

After implementation:

1. `cd api && tsgo --noEmit` — no type errors
2. `cd api && bun test src/__tests__/diff-sets.test.ts` — pure function tests pass
3. `cd api && bun test src/__tests__/reconcile-set.test.ts` — Effect combinator tests pass
4. `cd api && bun test src/__tests__/reconciler-runtime.test.ts` — runtime tests pass
5. `cd api && bun test src/__tests__/route-reconciler.test.ts` — first migration passes
6. `cd api && pnpm test` — full suite passes (existing tests unaffected)
7. Manual: start dev server, create a route, verify it gets reconciled by the new framework
