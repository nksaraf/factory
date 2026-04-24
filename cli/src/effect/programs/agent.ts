import { Effect, Schedule, Duration } from "effect"
import { isDevComponent } from "@smp/factory-shared"
import { DependencyGraph } from "@smp/factory-shared/dependency-graph"
import { SiteConfig } from "../services/site-config.js"
import { SiteState } from "../services/site-state.js"
import { DockerComposeOps } from "../services/docker-compose-ops.js"
import { DependencyConnector } from "../services/dependency-connector.js"
import { CrossSystemLinker } from "../services/cross-system-linker.js"
import { TunnelManager } from "../services/tunnel-manager.js"
import { BuildCache } from "../services/build-cache.js"
import { HealthMonitor } from "../services/health-monitor.js"
import { AgentServer } from "../services/agent-server.js"
import { SiteReconciler } from "../services/site-reconciler.js"
import { ControlPlaneLink } from "../services/control-plane-link.js"
import { ControllerStateStore } from "../services/controller-state-store.js"
import { hostname } from "node:os"

const workbenchSlug = () => hostname().replace(/\.local$/, "")

// ---------------------------------------------------------------------------
// Phase 1a: Write desired state from local source (dev + up)
//
// Requires a project directory with docker-compose.yaml.
//
// Dev and up are the same flow. The only difference: in dev mode, components
// with a dev command run as native processes and only they + their deps are
// started. In up mode, everything is a container.
// ---------------------------------------------------------------------------

const writeLocalSpec = Effect.gen(function* () {
  const config = yield* SiteConfig
  const siteState = yield* SiteState
  const composeOps = yield* DockerComposeOps
  const connResolver = yield* DependencyConnector
  const crossLinker = yield* CrossSystemLinker
  const buildCache = yield* BuildCache
  const stateStore = yield* ControllerStateStore

  const sys = config.focusSystem
  const sdSlug = sys.sdSlug
  const flags = config.sessionFlags ?? {}
  const catalog = sys.catalog
  const isDev = config.mode === "dev"

  // 1. Reset intent — yesterday's flags don't leak into today's session
  const savedStatuses = yield* siteState.resetIntent
  yield* siteState.ensureSystemDeployment(
    sdSlug,
    sys.name,
    "docker-compose",
    sys.composeFiles
  )

  // 2. Resolve connections (--connect-to, --connect, --profile)
  let connectionEnv: Record<string, string> = {}
  const remoteDeps: string[] = []
  if (config.connectionFlags) {
    const conn = yield* connResolver.resolve(config.connectionFlags)
    if (conn) {
      connectionEnv = conn.env
      remoteDeps.push(...conn.remoteDeps)
    }
  }

  // 3. Cross-system linking (x-dx.dependencies)
  const connectList = config.connectionFlags?.connect ?? []
  const linkedSds = yield* crossLinker.resolve({
    connects: connectList,
    connectTo: config.connectionFlags?.connectTo,
  })
  if (linkedSds.length > 0) {
    connectionEnv = yield* crossLinker.apply(linkedSds, connectionEnv)
  }

  // 4. Determine which components to run and in what mode
  const remoteDepSet = new Set(remoteDeps)
  const wb = workbenchSlug()
  const allComponentNames = Object.keys(catalog.components)
  const allResourceNames = Object.keys(catalog.resources)
  const graph = DependencyGraph.fromCatalog(catalog)

  if (isDev) {
    // Dev mode: only start targets + their transitive deps
    // dx dev           → all devable components
    // dx dev api web   → just api and web
    const devTargets = new Set(
      flags.components?.length
        ? flags.components
        : allComponentNames.filter((name) =>
            isDevComponent(catalog.components[name]!)
          )
    )

    // Transitive deps of dev targets → container
    const localDockerDeps = new Set<string>()
    for (const target of devTargets) {
      for (const dep of graph.transitiveDeps(target)) {
        if (!devTargets.has(dep) && !remoteDepSet.has(dep)) {
          localDockerDeps.add(dep)
        }
      }
    }

    // Set modes for only the components we need
    for (const name of devTargets) {
      if (remoteDepSet.has(name)) {
        yield* siteState.setComponentMode(sdSlug, name, "linked")
      } else {
        yield* siteState.setComponentMode(sdSlug, name, "native", {
          workbenchSlug: wb,
        })
        yield* siteState.bumpGeneration(sdSlug, name)
      }
    }
    for (const name of localDockerDeps) {
      yield* siteState.setComponentMode(sdSlug, name, "container")
    }
    for (const name of remoteDeps) {
      if (!devTargets.has(name)) {
        yield* siteState.setComponentMode(sdSlug, name, "linked")
      }
    }

    // Restore runtime status + build check for docker deps
    const allActive = [...devTargets, ...localDockerDeps]
    for (const name of allActive) {
      yield* siteState.restoreStatus(sdSlug, name, savedStatuses)
    }

    const containerDeps = [...localDockerDeps].filter((name) =>
      allComponentNames.includes(name)
    )
    if (containerDeps.length > 0) {
      const buildCheck = yield* buildCache.check(catalog, containerDeps)
      const needsBuild = flags.noBuild ? [] : buildCheck.needsBuild
      if (needsBuild.length > 0) {
        yield* composeOps.build(needsBuild)
        yield* buildCache.record(catalog, needsBuild)
      }
    }
  } else {
    // Up mode: everything runs as container
    const allNames = [...allComponentNames, ...allResourceNames]
    for (const name of allNames) {
      if (remoteDepSet.has(name)) {
        yield* siteState.setComponentMode(sdSlug, name, "linked")
      } else {
        yield* siteState.setComponentMode(sdSlug, name, "container")
      }
    }

    for (const name of allNames) {
      yield* siteState.restoreStatus(sdSlug, name, savedStatuses)
    }

    // Build check — only for components, not resources
    const buildable = allComponentNames.filter((n) => !remoteDepSet.has(n))
    if (buildable.length > 0) {
      const buildCheck = yield* buildCache.check(catalog, buildable)
      const needsBuild = flags.noBuild ? [] : buildCheck.needsBuild
      if (needsBuild.length > 0) {
        yield* composeOps.build(needsBuild)
        yield* buildCache.record(catalog, needsBuild)
      }
    }
  }

  // 5. Save state + derive manifest for reconciler
  yield* siteState.save
  const manifest = yield* siteState.toManifest(sdSlug, catalog)
  if (manifest) {
    yield* stateStore.saveManifest(manifest)
  }
}).pipe(Effect.withSpan("writeDesiredState.local"))

// ---------------------------------------------------------------------------
// Phase 1b: Write desired state from control plane (controller)
//
// Does NOT require source code. The manifest comes from the Factory API.
// Can run from any directory on any host.
// ---------------------------------------------------------------------------

const writeControllerSpec = Effect.gen(function* () {
  const controlPlane = yield* ControlPlaneLink
  const stateStore = yield* ControllerStateStore

  const manifest = yield* controlPlane.fetchManifest.pipe(
    Effect.catchAll(() => Effect.succeed(null))
  )

  if (manifest) {
    yield* stateStore.saveManifest(manifest)
    yield* Effect.logInfo(
      "Received and saved manifest from control plane"
    ).pipe(Effect.annotateLogs({ version: manifest.version }))
  }
}).pipe(Effect.withSpan("writeDesiredState.controller"))

// ---------------------------------------------------------------------------
// Phase 2: Reconcile + Monitor + Serve (identical in all modes)
//
// 1. Reconcile ONCE synchronously (wait for completion — user sees results)
// 2. Fork background reconcile loop (catches drift, handles restarts)
// 3. Fork health monitor
// 4. Start HTTP server
// 5. Block forever (scope finalizers handle shutdown)
// ---------------------------------------------------------------------------

const runDaemon = Effect.gen(function* () {
  const config = yield* SiteConfig
  const reconciler = yield* SiteReconciler
  const healthMonitor = yield* HealthMonitor
  const agentServer = yield* AgentServer
  const tunnelManager = yield* TunnelManager

  // Initial reconcile — synchronous, so the user sees containers come up
  yield* reconciler.reconcile.pipe(
    Effect.catchAll((err) =>
      Effect.logWarning("Initial reconcile failed").pipe(
        Effect.annotateLogs({ error: err.message })
      )
    ),
    Effect.withSpan("runDaemon.initialReconcile")
  )

  // Background reconcile loop — catches drift, handles crashed components
  const reconcileLoop = reconciler.reconcile.pipe(
    Effect.catchAll((err) =>
      Effect.logWarning("Reconcile cycle failed").pipe(
        Effect.annotateLogs({ error: err.message })
      )
    ),
    Effect.repeat(Schedule.spaced(Duration.millis(config.reconcileIntervalMs)))
  )

  yield* Effect.fork(reconcileLoop)
  yield* Effect.fork(healthMonitor.fiber)

  // Tunnel (dev mode with --tunnel flag)
  if (config.mode === "dev" && config.sessionFlags?.tunnel) {
    const siteState = yield* SiteState
    const sd = yield* siteState.getSystemDeployment(config.focusSystem.sdSlug)
    const declaredPorts: number[] = []
    for (const cd of sd?.componentDeployments ?? []) {
      if (cd.status.port) declaredPorts.push(cd.status.port)
    }
    if (declaredPorts.length > 0) {
      yield* tunnelManager.open({
        subdomain: workbenchSlug(),
        port: declaredPorts[0]!,
        publishPorts: declaredPorts,
      })
    }
  }

  yield* agentServer.start
  return yield* Effect.never
}).pipe(Effect.withSpan("runDaemon"))

// ---------------------------------------------------------------------------
// Unified agent program
// ---------------------------------------------------------------------------

export const agentDaemon = Effect.scoped(
  Effect.gen(function* () {
    const config = yield* SiteConfig

    // Phase 1: Write desired state
    if (config.mode === "controller") {
      yield* writeControllerSpec
    } else {
      yield* writeLocalSpec
    }

    // Phase 2: Reconcile once, then loop + monitor + serve
    return yield* runDaemon
  })
).pipe(Effect.withSpan("agentDaemon"))
