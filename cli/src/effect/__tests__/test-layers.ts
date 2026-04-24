import { Effect, Layer, Ref, Stream, PubSub } from "effect"
import { SiteConfig, type ISiteConfig } from "../services/site-config.js"
import {
  SiteState,
  type ISiteState,
  type SavedComponentStatus,
} from "../services/site-state.js"
import {
  Executor,
  type IExecutor,
  type ComponentState,
  type DeployResult,
} from "../services/executor.js"
import {
  ControllerStateStore,
  type IControllerStateStore,
} from "../services/controller-state-store.js"
import {
  DockerComposeOps,
  type IDockerComposeOps,
} from "../services/docker-compose-ops.js"
import { BuildCache, type IBuildCache } from "../services/build-cache.js"
import {
  DependencyConnector,
  type IDependencyConnector,
} from "../services/dependency-connector.js"
import {
  CrossSystemLinker,
  type ICrossSystemLinker,
} from "../services/cross-system-linker.js"
import {
  TunnelManager,
  type ITunnelManager,
} from "../services/tunnel-manager.js"
import { AgentServer, type IAgentServer } from "../services/agent-server.js"
import {
  HealthMonitor,
  type IHealthMonitor,
} from "../services/health-monitor.js"
import {
  SiteReconciler,
  type ISiteReconciler,
} from "../services/site-reconciler.js"
import {
  ControlPlaneLink,
  type IControlPlaneLink,
} from "../services/control-plane-link.js"
import {
  ExecutorError,
  ControlPlaneLinkError,
  ProbeFailedError,
} from "../errors/site.js"
import type { SiteManifest } from "../../site/manifest.js"
import type {
  ComponentDeploymentMode,
  ComponentDeploymentStatus,
  LocalSystemDeployment,
  SiteState as SiteStateData,
} from "@smp/factory-shared"
import { makeDevConfig } from "./fixtures"
import { makeEventJournal } from "@smp/factory-shared/effect/event-journal"

// ---------------------------------------------------------------------------
// Recording Executor — tracks every call
// ---------------------------------------------------------------------------

export interface ExecutorCall {
  method: string
  args: unknown[]
}

export function makeRecordingExecutor(opts?: {
  inspectResult?: ComponentState[]
  failOnDeploy?: string[]
}) {
  const calls: ExecutorCall[] = []

  const impl: IExecutor = {
    type: "recording",
    parseCatalog: Effect.succeed({
      name: "",
      slug: "",
      spec: {},
      components: {},
      resources: {},
      apis: {},
    } as any),
    inspect: Effect.succeed(opts?.inspectResult ?? []),
    inspectOne: (component) => {
      calls.push({ method: "inspectOne", args: [component] })
      return Effect.succeed({
        name: component,
        image: "",
        status: "running" as const,
        health: "none" as const,
        ports: [],
      })
    },
    deploy: (component, desired) => {
      calls.push({ method: "deploy", args: [component, desired] })
      if (opts?.failOnDeploy?.includes(component)) {
        return Effect.fail(
          new ExecutorError({
            executor: "test",
            operation: "deploy",
            component,
            cause: "test failure",
          })
        )
      }
      return Effect.succeed({
        actualImage: desired.image,
        status: "running" as const,
      } as DeployResult)
    },
    stop: (component) => {
      calls.push({ method: "stop", args: [component] })
      return Effect.void
    },
    scale: (component, replicas) => {
      calls.push({ method: "scale", args: [component, replicas] })
      return Effect.void
    },
    restart: (component) => {
      calls.push({ method: "restart", args: [component] })
      return Effect.void
    },
    runInit: (name) => {
      calls.push({ method: "runInit", args: [name] })
      return Effect.succeed({ exitCode: 0, output: "" })
    },
    logs: (component) => {
      calls.push({ method: "logs", args: [component] })
      return Effect.succeed("")
    },
    logStream: (component) => Stream.make("log line"),
    run: (component, cmd) => {
      calls.push({ method: "run", args: [component, cmd] })
      return Effect.succeed({ exitCode: 0, stdout: "", stderr: "" })
    },
    healthCheck: (component) => Effect.succeed("healthy" as const),
    healthCheckAll: Effect.succeed({}),
    runProbe: (component, probe) =>
      Effect.fail(
        new ProbeFailedError({
          component,
          probeType: "liveness",
          cause: "not implemented",
        })
      ),
  }

  return {
    calls,
    layer: Layer.succeed(Executor, Executor.of(impl)),
  }
}

// ---------------------------------------------------------------------------
// In-memory SiteState — Ref-backed, no filesystem
// ---------------------------------------------------------------------------

export function makeTestSiteState() {
  const componentModes = new Map<
    string,
    { mode: ComponentDeploymentMode; opts?: object }
  >()
  const generations = new Map<string, number>()
  const conditions = new Map<string, Array<{ type: string; status: string }>>()
  let savedCount = 0

  const impl: ISiteState = {
    getState: Effect.succeed({
      spec: {
        site: { slug: "test" },
        workbench: { slug: "test" },
        mode: "dev" as const,
        systemDeployments: [],
      },
      status: { phase: "pending" as const, conditions: [], updatedAt: "" },
    } as any),
    getSpec: Effect.succeed({
      site: { slug: "test" },
      workbench: { slug: "test" },
      mode: "dev" as const,
      systemDeployments: [],
    } as any),
    getStatus: Effect.succeed({
      phase: "pending" as const,
      conditions: [],
      updatedAt: "",
    } as any),
    getSystemDeployment: (slug) => Effect.succeed(undefined),
    getComponentMode: (sdSlug, component) =>
      Effect.succeed(componentModes.get(component)?.mode ?? null),
    ensureSystemDeployment: (slug, systemSlug, runtime, composeFiles) =>
      Effect.succeed({
        slug,
        systemSlug,
        runtime,
        composeFiles,
        componentDeployments: [],
        resolvedEnv: {},
        tunnels: [],
      } as any),
    ensureLinkedSystemDeployment: (slug, systemSlug, linkedRef) =>
      Effect.succeed({ slug, systemSlug, linkedRef } as any),
    setComponentMode: (sdSlug, component, mode, opts) => {
      componentModes.set(component, { mode, opts })
      return Effect.void
    },
    updateComponentStatus: () => Effect.void,
    setCondition: (sdSlug, component, condition) => {
      const existing = conditions.get(component) ?? []
      existing.push({ type: condition.type, status: condition.status })
      conditions.set(component, existing)
      return Effect.void
    },
    setPhase: () => Effect.void,
    setResolvedEnv: () => Effect.void,
    bumpGeneration: (sdSlug, component) => {
      generations.set(component, (generations.get(component) ?? 0) + 1)
      return Effect.void
    },
    setMode: () => Effect.void,
    resetIntent: Effect.succeed(new Map()),
    restoreStatus: () => Effect.void,
    save: Effect.sync(() => {
      savedCount++
    }),
    toManifest: () => Effect.succeed(null),
    init: () => Effect.void,
  }

  return {
    componentModes,
    generations,
    conditions,
    getSaveCount: () => savedCount,
    layer: Layer.succeed(SiteState, SiteState.of(impl)),
  }
}

// ---------------------------------------------------------------------------
// In-memory ControllerStateStore
// ---------------------------------------------------------------------------

export function makeTestControllerStateStore() {
  let manifest: SiteManifest | null = null

  const impl: IControllerStateStore = {
    getLastManifest: Effect.sync(() => manifest),
    saveManifest: (m) =>
      Effect.sync(() => {
        manifest = m
      }),
    recordImageDeploy: () => Effect.void,
    getPreviousImage: () => Effect.succeed(null),
    getImageHistory: () => Effect.succeed([]),
    getStartedAt: Effect.succeed(new Date().toISOString()),
  }

  return {
    getManifest: () => manifest,
    layer: Layer.succeed(ControllerStateStore, ControllerStateStore.of(impl)),
  }
}

// ---------------------------------------------------------------------------
// Noop services
// ---------------------------------------------------------------------------

export const NoopDockerComposeOps = Layer.succeed(
  DockerComposeOps,
  DockerComposeOps.of({
    build: () => Effect.void,
    stop: () => Effect.void,
    up: () => Effect.void,
    isDockerRunning: Effect.succeed(true),
  })
)

export const NoopBuildCache = Layer.succeed(
  BuildCache,
  BuildCache.of({
    check: () =>
      Effect.succeed({ needsBuild: [], upToDate: [], skipped: [] } as any),
    record: () => Effect.void,
  })
)

export const NoopDependencyConnector = Layer.succeed(
  DependencyConnector,
  DependencyConnector.of({
    resolve: () => Effect.succeed(null),
    apply: () => Effect.succeed([]),
    restoreLocal: () => Effect.void,
  })
)

export const NoopCrossSystemLinker = Layer.succeed(
  CrossSystemLinker,
  CrossSystemLinker.of({
    resolve: () => Effect.succeed([]),
    apply: (_, env) => Effect.succeed(env),
  })
)

export const NoopTunnelManager = Layer.succeed(
  TunnelManager,
  TunnelManager.of({
    open: () => Effect.succeed({ url: "", subdomain: "" }),
    getState: Effect.succeed({ status: "disconnected" as const }),
  })
)

export const NoopAgentServer = Layer.succeed(
  AgentServer,
  AgentServer.of({
    start: Effect.succeed({ port: 4299, stop: Effect.void }),
  })
)

export const NoopHealthMonitor = Layer.succeed(
  HealthMonitor,
  HealthMonitor.of({
    latest: Effect.succeed(null),
    changes: null as any,
    fiber: Effect.never,
  })
)

export const NoopControlPlaneLink = Layer.succeed(
  ControlPlaneLink,
  ControlPlaneLink.of({
    checkin: () => Effect.succeed({ manifestChanged: false }),
    fetchManifest: Effect.fail(
      new ControlPlaneLinkError({ operation: "fetchManifest", cause: "noop" })
    ),
    reportState: () => Effect.void,
    checkForUpdates: () => Effect.succeed(null),
  })
)

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

export function makeTestConfig(config: ISiteConfig) {
  return Layer.succeed(SiteConfig, SiteConfig.of(config))
}
