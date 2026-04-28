import { describe, test, expect } from "bun:test"
import { Effect, Layer, Fiber, Duration } from "effect"
import { agentDaemon } from "../programs/agent.js"
import { SiteState } from "../services/site-state.js"
import {
  SiteReconciler,
  type ReconcileResult,
} from "../services/site-reconciler.js"
import { AgentServer } from "../services/agent-server.js"
import { TunnelManager, type TunnelOpts } from "../services/tunnel-manager.js"
import { ControlPlaneLink } from "../services/control-plane-link.js"
import { ExecutorError, ControlPlaneLinkError } from "../errors/site.js"
import {
  makeTestSiteState,
  makeTestConfig,
  NoopDockerComposeOps,
  NoopDependencyConnector,
  NoopCrossSystemLinker,
  NoopBuildCache,
  NoopHealthMonitor,
} from "./test-layers"
import { makeDevConfig, makeUpConfig, makeControllerConfig } from "./fixtures"
import type { ComponentDeploymentMode } from "@smp/factory-shared"
import type { ISiteConfig } from "../services/site-config.js"

// ---------------------------------------------------------------------------
// Recording doubles
// ---------------------------------------------------------------------------

function makeRecordingReconciler(opts?: { failOnCall?: number[] }) {
  const calls: number[] = []
  let n = 0

  const layer = Layer.succeed(
    SiteReconciler,
    SiteReconciler.of({
      reconcile: Effect.suspend(() => {
        const i = n++
        calls.push(i)
        if (opts?.failOnCall?.includes(i)) {
          return Effect.fail(
            new ExecutorError({
              executor: "test",
              operation: "reconcile",
              component: "unknown",
              cause: `fail #${i}`,
            })
          )
        }
        return Effect.succeed({
          success: true,
          stepsApplied: 0,
          stepsTotal: 0,
          errors: [],
          plan: { steps: [], upToDate: [] } as any,
          durationMs: 1,
          reconciliationId: `r-${i}`,
        } satisfies ReconcileResult)
      }),
      executeStep: () => Effect.void as any,
      events: {
        emit: () => Effect.void,
        recent: Effect.succeed([]),
        subscribe: null as any,
      },
      lastResult: Effect.succeed(null),
    })
  )

  return { calls, layer }
}

function makeRecordingTunnel() {
  const calls: TunnelOpts[] = []

  const layer = Layer.succeed(
    TunnelManager,
    TunnelManager.of({
      open: (o) => {
        calls.push(o)
        return Effect.succeed({
          url: "https://test.tunnel",
          subdomain: o.subdomain,
        })
      },
      getState: Effect.succeed({ status: "disconnected" as const }),
    })
  )

  return { calls, layer }
}

function makeRecordingServer() {
  let count = 0

  const layer = Layer.succeed(
    AgentServer,
    AgentServer.of({
      start: Effect.sync(() => {
        count++
        return { port: 4299, stop: Effect.void }
      }),
    })
  )

  return { getStartCount: () => count, layer }
}

function makeRecordingControlPlane() {
  const calls: string[] = []

  const layer = Layer.succeed(
    ControlPlaneLink,
    ControlPlaneLink.of({
      checkin: () => {
        calls.push("checkin")
        return Effect.succeed({ manifestChanged: false })
      },
      fetchManifest: Effect.suspend(() => {
        calls.push("fetchManifest")
        return Effect.fail(
          new ControlPlaneLinkError({
            operation: "fetchManifest",
            cause: "test",
          })
        )
      }),
      reportState: () => Effect.void,
      checkForUpdates: () => Effect.succeed(null),
    })
  )

  return { calls, layer }
}

function makeSiteStateWithPorts(ports: number[]) {
  const componentModes = new Map<
    string,
    { mode: ComponentDeploymentMode; opts?: object }
  >()
  const generations = new Map<string, number>()

  const layer = Layer.succeed(
    SiteState,
    SiteState.of({
      getState: Effect.succeed({
        spec: {
          site: { slug: "test" },
          workbench: { slug: "test" },
          mode: "dev",
          systemDeployments: [],
        },
        status: { phase: "pending", conditions: [], updatedAt: "" },
      } as any),
      getSpec: Effect.succeed({
        site: { slug: "test" },
        workbench: { slug: "test" },
        mode: "dev",
        systemDeployments: [],
      } as any),
      getStatus: Effect.succeed({
        phase: "pending",
        conditions: [],
        updatedAt: "",
      } as any),
      getSystemDeployment: () =>
        Effect.succeed({
          slug: "test-system",
          systemSlug: "test-system",
          runtime: "docker-compose",
          composeFiles: ["docker-compose.yaml"],
          componentDeployments: ports.map((p, i) => ({
            componentSlug: `comp-${i}`,
            mode: "native" as const,
            spec: { generation: 1 },
            status: { port: p, conditions: [] },
          })),
          resolvedEnv: {},
          tunnels: [],
        } as any),
      getComponentMode: (_, component) =>
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
      setComponentMode: (_, component, mode, opts) => {
        componentModes.set(component, { mode, opts })
        return Effect.void
      },
      updateComponentStatus: () => Effect.void,
      setCondition: () => Effect.void,
      setPhase: () => Effect.void,
      setResolvedEnv: () => Effect.void,
      bumpGeneration: (_, component) => {
        generations.set(component, (generations.get(component) ?? 0) + 1)
        return Effect.void
      },
      setMode: () => Effect.void,
      resetIntent: Effect.succeed(new Map()),
      restoreStatus: () => Effect.void,
      save: Effect.void,
      toManifest: () => Effect.succeed(null),
      init: () => Effect.void,
    })
  )

  return { layer }
}

// ---------------------------------------------------------------------------
// Layer builder
// ---------------------------------------------------------------------------

function buildDaemonLayer(opts?: {
  config?: ISiteConfig
  reconcileFailOnCall?: number[]
  siteStatePorts?: number[]
}) {
  const config = opts?.config ?? makeDevConfig()
  const reconciler = makeRecordingReconciler({
    failOnCall: opts?.reconcileFailOnCall,
  })
  const tunnel = makeRecordingTunnel()
  const server = makeRecordingServer()
  const controlPlane = makeRecordingControlPlane()
  const siteState = opts?.siteStatePorts
    ? makeSiteStateWithPorts(opts.siteStatePorts)
    : makeTestSiteState()

  const layer = Layer.mergeAll(
    makeTestConfig(config),
    siteState.layer,
    reconciler.layer,
    tunnel.layer,
    server.layer,
    controlPlane.layer,
    NoopDockerComposeOps,
    NoopDependencyConnector,
    NoopCrossSystemLinker,
    NoopBuildCache,
    NoopHealthMonitor
  )

  return { reconciler, tunnel, server, controlPlane, layer }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("agentDaemon lifecycle", () => {
  describe("initial reconcile", () => {
    test("runs synchronously during setup", async () => {
      const { reconciler, layer } = buildDaemonLayer()

      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(agentDaemon)
          yield* Effect.sleep(Duration.millis(100))

          expect(reconciler.calls[0]).toBe(0)

          yield* Fiber.interrupt(fiber)
        }).pipe(Effect.provide(layer))
      )
    })

    test("failure is caught — daemon continues to start server", async () => {
      const { reconciler, server, layer } = buildDaemonLayer({
        reconcileFailOnCall: [0],
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(agentDaemon)
          yield* Effect.sleep(Duration.millis(100))

          expect(reconciler.calls).toContain(0)
          expect(server.getStartCount()).toBe(1)

          yield* Fiber.interrupt(fiber)
        }).pipe(Effect.provide(layer))
      )
    })
  })

  describe("background reconcile loop", () => {
    test("fires multiple iterations after initial reconcile", async () => {
      const { reconciler, layer } = buildDaemonLayer({
        config: makeDevConfig({ reconcileIntervalMs: 10 }),
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(agentDaemon)
          yield* Effect.sleep(Duration.millis(200))

          expect(reconciler.calls.length).toBeGreaterThan(2)

          yield* Fiber.interrupt(fiber)
        }).pipe(Effect.provide(layer))
      )
    })

    test("continues after a failed cycle", async () => {
      const { reconciler, layer } = buildDaemonLayer({
        config: makeDevConfig({ reconcileIntervalMs: 10 }),
        reconcileFailOnCall: [1],
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(agentDaemon)
          yield* Effect.sleep(Duration.millis(200))

          expect(reconciler.calls).toContain(1)
          expect(reconciler.calls).toContain(2)
          expect(reconciler.calls.length).toBeGreaterThan(2)

          yield* Fiber.interrupt(fiber)
        }).pipe(Effect.provide(layer))
      )
    })
  })

  describe("agent server", () => {
    test("starts during daemon setup", async () => {
      const { server, layer } = buildDaemonLayer()

      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(agentDaemon)
          yield* Effect.sleep(Duration.millis(100))

          expect(server.getStartCount()).toBe(1)

          yield* Fiber.interrupt(fiber)
        }).pipe(Effect.provide(layer))
      )
    })
  })

  describe("tunnel", () => {
    test("opens in dev mode with --tunnel and declared ports", async () => {
      const { tunnel, layer } = buildDaemonLayer({
        config: makeDevConfig({ sessionFlags: { tunnel: true } }),
        siteStatePorts: [3000, 3001],
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(agentDaemon)
          yield* Effect.sleep(Duration.millis(100))

          expect(tunnel.calls).toHaveLength(1)
          expect(tunnel.calls[0]!.port).toBe(3000)
          expect(tunnel.calls[0]!.publishPorts).toEqual([3000, 3001])

          yield* Fiber.interrupt(fiber)
        }).pipe(Effect.provide(layer))
      )
    })

    test("not opened without --tunnel flag", async () => {
      const { tunnel, layer } = buildDaemonLayer({
        config: makeDevConfig(),
        siteStatePorts: [3000],
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(agentDaemon)
          yield* Effect.sleep(Duration.millis(100))

          expect(tunnel.calls).toHaveLength(0)

          yield* Fiber.interrupt(fiber)
        }).pipe(Effect.provide(layer))
      )
    })

    test("not opened in up mode regardless of --tunnel", async () => {
      const { tunnel, layer } = buildDaemonLayer({
        config: makeUpConfig({ sessionFlags: { tunnel: true } }),
        siteStatePorts: [3000],
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(agentDaemon)
          yield* Effect.sleep(Duration.millis(100))

          expect(tunnel.calls).toHaveLength(0)

          yield* Fiber.interrupt(fiber)
        }).pipe(Effect.provide(layer))
      )
    })

    test("not opened when no ports declared", async () => {
      const { tunnel, layer } = buildDaemonLayer({
        config: makeDevConfig({ sessionFlags: { tunnel: true } }),
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(agentDaemon)
          yield* Effect.sleep(Duration.millis(100))

          expect(tunnel.calls).toHaveLength(0)

          yield* Fiber.interrupt(fiber)
        }).pipe(Effect.provide(layer))
      )
    })
  })

  describe("controller mode", () => {
    test("fetches manifest from control plane", async () => {
      const { controlPlane, layer } = buildDaemonLayer({
        config: makeControllerConfig(),
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(agentDaemon)
          yield* Effect.sleep(Duration.millis(100))

          expect(controlPlane.calls).toContain("fetchManifest")

          yield* Fiber.interrupt(fiber)
        }).pipe(Effect.provide(layer))
      )
    })

    test("fetchManifest failure is caught — daemon continues", async () => {
      const { controlPlane, server, layer } = buildDaemonLayer({
        config: makeControllerConfig(),
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(agentDaemon)
          yield* Effect.sleep(Duration.millis(100))

          expect(controlPlane.calls).toContain("fetchManifest")
          expect(server.getStartCount()).toBe(1)

          yield* Fiber.interrupt(fiber)
        }).pipe(Effect.provide(layer))
      )
    })
  })
})
