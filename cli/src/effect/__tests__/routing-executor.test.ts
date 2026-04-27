import { describe, test, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { RoutingExecutorLive } from "../layers/executor/routing.js"
import { DockerComposeExecutor } from "../layers/executor/docker-compose.js"
import { DevProcessExecutor } from "../layers/executor/dev-process.js"
import {
  Executor,
  type IExecutor,
  type ComponentState,
} from "../services/executor.js"
import { SiteState } from "../services/site-state.js"
import { ExecutorError, ProbeFailedError } from "../errors/site.js"
import { Stream } from "effect"
import type { ComponentDeploymentMode } from "@smp/factory-shared"

function makeStubExecutor(
  type: string,
  opts?: { inspectResult?: ComponentState[] }
): IExecutor {
  const calls: Array<{ method: string; args: unknown[] }> = []
  return {
    type,
    parseCatalog: Effect.succeed({} as any),
    inspect: Effect.succeed(opts?.inspectResult ?? []),
    inspectOne: (c) =>
      Effect.succeed({
        name: c,
        image: "",
        status: "running" as const,
        health: "none" as const,
        ports: [],
      }),
    deploy: (c, d) => {
      calls.push({ method: "deploy", args: [c] })
      return Effect.succeed({
        actualImage: d.image,
        status: "running" as const,
      })
    },
    stop: (c) => {
      calls.push({ method: "stop", args: [c] })
      return Effect.void
    },
    scale: (c, n) => {
      calls.push({ method: "scale", args: [c, n] })
      return Effect.void
    },
    restart: (c) => {
      calls.push({ method: "restart", args: [c] })
      return Effect.void
    },
    runInit: (n) => Effect.succeed({ exitCode: 0, output: "" }),
    logs: (c) => Effect.succeed(""),
    logStream: (c) => Stream.make("line"),
    run: (c, cmd) => Effect.succeed({ exitCode: 0, stdout: "", stderr: "" }),
    healthCheck: (c) => Effect.succeed("healthy" as const),
    healthCheckAll: Effect.succeed({}),
    runProbe: (c, p) =>
      Effect.fail(
        new ProbeFailedError({
          component: c,
          probeType: "liveness",
          cause: "stub",
        })
      ),
    _calls: calls,
  } as IExecutor & { _calls: typeof calls }
}

function buildRoutingLayer(opts: {
  modes: Record<string, ComponentDeploymentMode>
  composeInspect?: ComponentState[]
  nativeInspect?: ComponentState[]
  sdComponentDeployments?: Array<{
    componentSlug: string
    mode: ComponentDeploymentMode
    status: { port?: number }
  }>
}) {
  const composeExec = makeStubExecutor("compose", {
    inspectResult: opts.composeInspect ?? [],
  })
  const nativeExec = makeStubExecutor("native", {
    inspectResult: opts.nativeInspect ?? [],
  })

  const composeLayer = Layer.succeed(
    DockerComposeExecutor,
    DockerComposeExecutor.of(composeExec)
  )
  const nativeLayer = Layer.succeed(
    DevProcessExecutor,
    DevProcessExecutor.of(nativeExec)
  )

  const siteStateLayer = Layer.succeed(
    SiteState,
    SiteState.of({
      getState: Effect.succeed({} as any),
      getSpec: Effect.succeed({
        site: { slug: "test" },
        workbench: { slug: "test" },
        mode: "dev" as const,
        systemDeployments: [
          {
            slug: "test-system",
            systemSlug: "test-system",
            runtime: "docker-compose",
            composeFiles: [],
            componentDeployments:
              opts.sdComponentDeployments?.map((cd) => ({
                componentSlug: cd.componentSlug,
                mode: cd.mode,
                spec: { generation: 1 },
                status: { conditions: [], ...cd.status },
              })) ?? [],
            resolvedEnv: {},
            tunnels: [],
          },
        ],
      } as any),
      getStatus: Effect.succeed({} as any),
      getSystemDeployment: (slug) =>
        Effect.succeed({
          slug,
          systemSlug: "test-system",
          runtime: "docker-compose",
          composeFiles: [],
          componentDeployments:
            opts.sdComponentDeployments?.map((cd) => ({
              componentSlug: cd.componentSlug,
              mode: cd.mode,
              spec: { generation: 1 },
              status: { conditions: [], ...cd.status },
            })) ?? [],
          resolvedEnv: {},
          tunnels: [],
        } as any),
      getComponentMode: (_, component) =>
        Effect.succeed(opts.modes[component] ?? null),
      ensureSystemDeployment: () => Effect.succeed({} as any),
      ensureLinkedSystemDeployment: () => Effect.succeed({} as any),
      setComponentMode: () => Effect.void,
      updateComponentStatus: () => Effect.void,
      setCondition: () => Effect.void,
      setPhase: () => Effect.void,
      setResolvedEnv: () => Effect.void,
      bumpGeneration: () => Effect.void,
      setMode: () => Effect.void,
      resetIntent: Effect.succeed(new Map()),
      restoreStatus: () => Effect.void,
      save: Effect.void,
      toManifest: () => Effect.succeed(null),
      init: () => Effect.void,
    })
  )

  const layer = RoutingExecutorLive.pipe(
    Layer.provide(Layer.mergeAll(siteStateLayer, composeLayer, nativeLayer))
  )

  return { composeExec, nativeExec, layer }
}

describe("RoutingExecutor", () => {
  describe("deploy routing", () => {
    test("native mode → calls dev process executor", async () => {
      const { nativeExec, layer } = buildRoutingLayer({
        modes: { api: "native" },
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const exec = yield* Executor
          yield* exec.deploy("api", {
            image: "x",
            replicas: 1,
            envOverrides: {},
            resourceOverrides: {},
          })

          expect(
            (nativeExec as any)._calls.some(
              (c: any) => c.method === "deploy" && c.args[0] === "api"
            )
          ).toBe(true)
        }).pipe(Effect.provide(layer))
      )
    })

    test("container mode → calls compose executor", async () => {
      const { composeExec, layer } = buildRoutingLayer({
        modes: { postgres: "container" },
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const exec = yield* Executor
          yield* exec.deploy("postgres", {
            image: "x",
            replicas: 1,
            envOverrides: {},
            resourceOverrides: {},
          })

          expect(
            (composeExec as any)._calls.some(
              (c: any) => c.method === "deploy" && c.args[0] === "postgres"
            )
          ).toBe(true)
        }).pipe(Effect.provide(layer))
      )
    })

    test("linked mode → returns no-op success without calling any executor", async () => {
      const { composeExec, nativeExec, layer } = buildRoutingLayer({
        modes: { "staging-auth": "linked" },
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const exec = yield* Executor
          const result = yield* exec.deploy("staging-auth", {
            image: "",
            replicas: 1,
            envOverrides: {},
            resourceOverrides: {},
          })

          expect(result.actualImage).toBe("")
          expect(result.status).toBe("running")
          expect((composeExec as any)._calls).toHaveLength(0)
          expect((nativeExec as any)._calls).toHaveLength(0)
        }).pipe(Effect.provide(layer))
      )
    })

    test("service mode → same as linked (no-op)", async () => {
      const { layer } = buildRoutingLayer({
        modes: { stripe: "service" },
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const exec = yield* Executor
          const result = yield* exec.deploy("stripe", {
            image: "",
            replicas: 1,
            envOverrides: {},
            resourceOverrides: {},
          })

          expect(result.status).toBe("running")
        }).pipe(Effect.provide(layer))
      )
    })

    test("unknown mode (null) → defaults to compose executor", async () => {
      const { composeExec, layer } = buildRoutingLayer({
        modes: {},
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const exec = yield* Executor
          yield* exec.deploy("unknown-component", {
            image: "x",
            replicas: 1,
            envOverrides: {},
            resourceOverrides: {},
          })

          expect(
            (composeExec as any)._calls.some((c: any) => c.method === "deploy")
          ).toBe(true)
        }).pipe(Effect.provide(layer))
      )
    })
  })

  describe("stop/scale/restart on linked", () => {
    test("stop linked → void (no error)", async () => {
      const { layer } = buildRoutingLayer({ modes: { auth: "linked" } })

      await Effect.runPromise(
        Effect.gen(function* () {
          const exec = yield* Executor
          yield* exec.stop("auth")
        }).pipe(Effect.provide(layer))
      )
    })

    test("scale linked → void", async () => {
      const { layer } = buildRoutingLayer({ modes: { auth: "linked" } })

      await Effect.runPromise(
        Effect.gen(function* () {
          const exec = yield* Executor
          yield* exec.scale("auth", 3)
        }).pipe(Effect.provide(layer))
      )
    })

    test("restart linked → void", async () => {
      const { layer } = buildRoutingLayer({ modes: { auth: "linked" } })

      await Effect.runPromise(
        Effect.gen(function* () {
          const exec = yield* Executor
          yield* exec.restart("auth")
        }).pipe(Effect.provide(layer))
      )
    })
  })

  describe("inspect merging", () => {
    test("native component wins over compose (deduplication)", async () => {
      const { layer } = buildRoutingLayer({
        modes: { api: "native" },
        composeInspect: [
          {
            name: "api",
            image: "compose-img",
            status: "running",
            health: "none",
            ports: [],
          },
        ],
        nativeInspect: [
          {
            name: "api",
            image: "native-img",
            status: "running",
            health: "none",
            ports: [],
          },
        ],
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const exec = yield* Executor
          const states = yield* exec.inspect

          const apiStates = states.filter((s) => s.name === "api")
          expect(apiStates).toHaveLength(1)
          expect(apiStates[0]!.image).toBe("native-img")
        }).pipe(Effect.provide(layer))
      )
    })

    test("linked component appears as synthetic state", async () => {
      const { layer } = buildRoutingLayer({
        modes: { "staging-auth": "linked" },
        sdComponentDeployments: [
          {
            componentSlug: "staging-auth",
            mode: "linked",
            status: { port: 8080 },
          },
        ],
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const exec = yield* Executor
          const states = yield* exec.inspect

          const linked = states.find((s) => s.name === "staging-auth")
          expect(linked).toBeDefined()
          expect(linked!.status).toBe("running")
          expect(linked!.ports).toHaveLength(1)
          expect(linked!.ports[0]!.host).toBe(8080)
        }).pipe(Effect.provide(layer))
      )
    })

    test("service component appears with status unknown", async () => {
      const { layer } = buildRoutingLayer({
        modes: { stripe: "service" },
        sdComponentDeployments: [
          { componentSlug: "stripe", mode: "service", status: {} },
        ],
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const exec = yield* Executor
          const states = yield* exec.inspect

          const svc = states.find((s) => s.name === "stripe")
          expect(svc).toBeDefined()
          expect(svc!.status).toBe("unknown")
        }).pipe(Effect.provide(layer))
      )
    })

    test("linked component without port → empty ports array", async () => {
      const { layer } = buildRoutingLayer({
        modes: { auth: "linked" },
        sdComponentDeployments: [
          { componentSlug: "auth", mode: "linked", status: {} },
        ],
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const exec = yield* Executor
          const states = yield* exec.inspect

          const linked = states.find((s) => s.name === "auth")
          expect(linked!.ports).toHaveLength(0)
        }).pipe(Effect.provide(layer))
      )
    })
  })

  describe("healthCheck on linked", () => {
    test("returns 'none'", async () => {
      const { layer } = buildRoutingLayer({ modes: { auth: "linked" } })

      await Effect.runPromise(
        Effect.gen(function* () {
          const exec = yield* Executor
          const health = yield* exec.healthCheck("auth")
          expect(health).toBe("none")
        }).pipe(Effect.provide(layer))
      )
    })
  })

  describe("error cases", () => {
    test("logs on linked → ExecutorError", async () => {
      const { layer } = buildRoutingLayer({ modes: { auth: "linked" } })

      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const exec = yield* Executor
          yield* exec.logs("auth")
        }).pipe(Effect.provide(layer))
      )

      expect(exit._tag).toBe("Failure")
    })

    test("run on linked → ExecutorError", async () => {
      const { layer } = buildRoutingLayer({ modes: { auth: "linked" } })

      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const exec = yield* Executor
          yield* exec.run("auth", ["echo", "hi"])
        }).pipe(Effect.provide(layer))
      )

      expect(exit._tag).toBe("Failure")
    })
  })
})
