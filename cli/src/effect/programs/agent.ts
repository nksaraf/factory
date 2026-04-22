import { Effect, Schedule, Duration } from "effect"
import { isDevComponent } from "@smp/factory-shared"
import { DependencyGraph } from "@smp/factory-shared/dependency-graph"
import { SiteConfigTag } from "../services/site-config.js"
import { SiteStateTag } from "../services/site-state.js"
import { DockerComposeOpsTag } from "../services/docker-compose-ops.js"
import { DependencyConnectorTag } from "../services/dependency-connector.js"
import { CrossSystemLinkerTag } from "../services/cross-system-linker.js"
import { TunnelManagerTag } from "../services/tunnel-manager.js"
import { BuildCacheTag } from "../services/build-cache.js"
import { HealthMonitorTag } from "../services/health-monitor.js"
import { AgentServerTag } from "../services/agent-server.js"
import { SiteReconcilerTag } from "../services/site-reconciler.js"
import { ControlPlaneLinkTag } from "../services/control-plane-link.js"
import { ControllerStateStoreTag } from "../services/controller-state-store.js"
import { hostname } from "node:os"

const workbenchSlug = () => hostname().replace(/\.local$/, "")

// ---------------------------------------------------------------------------
// Phase 1a: Write desired state from CLI flags (dev + up)
//
// Dev and up are the same flow. The only difference: in dev mode, components
// with a dev command run as native processes; in up mode, everything is a
// container.
// ---------------------------------------------------------------------------

const writeLocalSpec = Effect.gen(function* () {
  const config = yield* SiteConfigTag
  const siteState = yield* SiteStateTag
  const composeOps = yield* DockerComposeOpsTag
  const connResolver = yield* DependencyConnectorTag
  const crossLinker = yield* CrossSystemLinkerTag
  const buildCache = yield* BuildCacheTag
  const stateStore = yield* ControllerStateStoreTag

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

  // 4. Assign component modes
  //    - remote deps → linked (served by another site)
  //    - dev mode + has dev command → native (source-linked process)
  //    - everything else → container (Docker Compose)
  const remoteDepSet = new Set(remoteDeps)
  const wb = workbenchSlug()

  const allComponentNames = Object.keys(catalog.components)
  const allResourceNames = Object.keys(catalog.resources)
  const allNames = [...allComponentNames, ...allResourceNames]

  // In dev mode, figure out which components are dev targets
  const devTargets = isDev
    ? new Set(
        flags.components?.length
          ? flags.components
          : allComponentNames.filter((name) =>
              isDevComponent(catalog.components[name]!)
            )
      )
    : new Set<string>()

  // In dev mode, also bring up transitive deps of dev targets as containers
  const graph = DependencyGraph.fromCatalog(catalog)
  const neededDeps = new Set<string>()
  for (const target of devTargets) {
    for (const dep of graph.transitiveDeps(target)) {
      if (!devTargets.has(dep)) neededDeps.add(dep)
    }
  }

  for (const name of allNames) {
    if (remoteDepSet.has(name)) {
      yield* siteState.setComponentMode(sdSlug, name, "linked")
    } else if (devTargets.has(name)) {
      yield* siteState.setComponentMode(sdSlug, name, "native", {
        workbenchSlug: wb,
      })
      yield* siteState.bumpGeneration(sdSlug, name)
    } else {
      yield* siteState.setComponentMode(sdSlug, name, "container")
    }
  }

  // 5. Restore runtime status from prior run (PIDs, ports survive restarts)
  for (const name of allNames) {
    yield* siteState.restoreStatus(sdSlug, name, savedStatuses)
  }

  // 6. Build check — only for components with build contexts, not resources
  const containerComponents = allComponentNames.filter(
    (name) => !devTargets.has(name) && !remoteDepSet.has(name)
  )
  if (containerComponents.length > 0) {
    const buildCheck = yield* buildCache.check(catalog, containerComponents)
    const needsBuild = flags.noBuild ? [] : buildCheck.needsBuild
    if (needsBuild.length > 0) {
      yield* composeOps.build(needsBuild)
      yield* buildCache.record(catalog, needsBuild)
    }
  }

  // 7. Save state + derive manifest for reconciler
  yield* siteState.save
  const manifest = yield* siteState.toManifest(sdSlug, catalog)
  if (manifest) {
    yield* stateStore.saveManifest(manifest)
  }
}).pipe(Effect.withSpan("writeDesiredState.local"))

// ---------------------------------------------------------------------------
// Phase 1b: Write desired state from control plane (controller)
// ---------------------------------------------------------------------------

const writeControllerSpec = Effect.gen(function* () {
  const controlPlane = yield* ControlPlaneLinkTag
  const stateStore = yield* ControllerStateStoreTag

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
// ---------------------------------------------------------------------------

const runDaemon = Effect.gen(function* () {
  const config = yield* SiteConfigTag
  const reconciler = yield* SiteReconcilerTag
  const healthMonitor = yield* HealthMonitorTag
  const agentServer = yield* AgentServerTag
  const tunnelManager = yield* TunnelManagerTag

  // Reconcile loop — converges actual state toward desired state
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
    const siteState = yield* SiteStateTag
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
    const config = yield* SiteConfigTag

    // Phase 1: Write desired state
    if (config.mode === "controller") {
      yield* writeControllerSpec
    } else {
      yield* writeLocalSpec
    }

    // Phase 2: Reconcile + monitor + serve
    return yield* runDaemon
  })
).pipe(Effect.withSpan("agentDaemon"))
