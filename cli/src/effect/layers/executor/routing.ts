import { Effect, Layer, Stream } from "effect"
import {
  Executor,
  type IExecutor,
  type ComponentState,
} from "../../services/executor.js"
import { SiteState } from "../../services/site-state.js"
import { DockerComposeExecutor } from "./docker-compose.js"
import { DevProcessExecutor } from "./dev-process.js"
import { ExecutorError, ProbeFailedError } from "../../errors/site.js"
import type { ComponentDeploymentMode } from "@smp/factory-shared"

export const RoutingExecutorLive = Layer.effect(
  Executor,
  Effect.gen(function* () {
    const siteState = yield* SiteState
    const composeExec = yield* DockerComposeExecutor
    const devExec = yield* DevProcessExecutor

    const spec = yield* siteState.getSpec
    const sdSlug = spec.systemDeployments[0]?.slug ?? ""

    function executorFor(
      mode: ComponentDeploymentMode | null
    ): IExecutor | null {
      switch (mode) {
        case "native":
          return devExec
        case "container":
          return composeExec
        case "linked":
        case "service":
          return null
        default:
          return composeExec
      }
    }

    function getMode(component: string) {
      return siteState.getComponentMode(sdSlug, component)
    }

    function syntheticState(component: string): Effect.Effect<ComponentState> {
      return Effect.flatMap(siteState.getSystemDeployment(sdSlug), (sd) =>
        Effect.sync(() => {
          const cd = sd?.componentDeployments.find(
            (c) => c.componentSlug === component
          )
          return {
            name: component,
            image: "",
            status: cd ? ("running" as const) : ("unknown" as const),
            health: "none" as const,
            ports: cd?.status.port
              ? [
                  {
                    host: cd.status.port,
                    container: cd.status.port,
                    protocol: "tcp",
                  },
                ]
              : [],
          }
        })
      )
    }

    function withExecutor<T>(
      component: string,
      operation: string,
      fn: (exec: IExecutor) => Effect.Effect<T, ExecutorError>
    ): Effect.Effect<T, ExecutorError> {
      return Effect.flatMap(getMode(component), (mode) => {
        const exec = executorFor(mode)
        if (!exec) {
          return Effect.fail(
            new ExecutorError({
              executor: "routing",
              operation,
              component,
              cause: `Component is externally managed (mode: ${mode})`,
            })
          )
        }
        return fn(exec)
      })
    }

    return Executor.of({
      type: "routing",

      parseCatalog: composeExec.parseCatalog,

      inspect: Effect.gen(function* () {
        const [composeStates, nativeStates] = yield* Effect.all([
          composeExec.inspect,
          devExec.inspect,
        ])

        const nativeNames = new Set(nativeStates.map((s) => s.name))
        const sd = yield* siteState.getSystemDeployment(sdSlug)
        const externalModes = new Set<string>()
        if (sd) {
          for (const cd of sd.componentDeployments) {
            if (cd.mode === "linked" || cd.mode === "service") {
              externalModes.add(cd.componentSlug)
            }
          }
        }

        const filtered = composeStates.filter(
          (s) => !nativeNames.has(s.name) && !externalModes.has(s.name)
        )

        const externalStates: ComponentState[] = []
        if (sd) {
          const composeNames = new Set(composeStates.map((s) => s.name))
          for (const cd of sd.componentDeployments) {
            if (cd.mode !== "linked" && cd.mode !== "service") continue
            if (nativeNames.has(cd.componentSlug)) continue
            if (composeNames.has(cd.componentSlug)) continue
            externalStates.push({
              name: cd.componentSlug,
              image: "",
              status: cd.mode === "linked" ? "running" : "unknown",
              health: "none",
              ports: cd.status.port
                ? [
                    {
                      host: cd.status.port,
                      container: cd.status.port,
                      protocol: "tcp",
                    },
                  ]
                : [],
            })
          }
        }

        return [...nativeStates, ...filtered, ...externalStates]
      }).pipe(Effect.withSpan("RoutingExecutor.inspect")),

      inspectOne: (component) =>
        Effect.flatMap(getMode(component), (mode) => {
          const exec = executorFor(mode)
          if (!exec) return syntheticState(component)
          return exec.inspectOne(component)
        }),

      deploy: (component, desired) =>
        Effect.flatMap(getMode(component), (mode) => {
          const exec = executorFor(mode)
          if (!exec)
            return Effect.succeed({
              actualImage: "",
              status: "running" as const,
            })
          return exec.deploy(component, desired)
        }).pipe(
          Effect.withSpan("RoutingExecutor.deploy", {
            attributes: { "component.name": component },
          })
        ),

      stop: (component, opts) =>
        Effect.flatMap(getMode(component), (mode) => {
          const exec = executorFor(mode)
          if (!exec) return Effect.void
          return exec.stop(component, opts)
        }),

      scale: (component, replicas) =>
        Effect.flatMap(getMode(component), (mode) => {
          const exec = executorFor(mode)
          if (!exec) return Effect.void
          return exec.scale(component, replicas)
        }),

      restart: (component) =>
        Effect.flatMap(getMode(component), (mode) => {
          const exec = executorFor(mode)
          if (!exec) return Effect.void
          return exec.restart(component)
        }),

      runInit: (initName) => composeExec.runInit(initName),

      logs: (component, opts) =>
        withExecutor(component, "logs", (exec) => exec.logs(component, opts)),

      logStream: (component, opts) =>
        Stream.unwrap(
          Effect.map(getMode(component), (mode) => {
            const exec = executorFor(mode)
            if (!exec) {
              return Stream.make(
                `Component ${component} is externally managed (${mode})`
              )
            }
            return exec.logStream(component, opts)
          })
        ),

      run: (component, cmd) =>
        withExecutor(component, "run", (exec) => exec.run(component, cmd)),

      healthCheck: (component) =>
        Effect.flatMap(getMode(component), (mode) => {
          const exec = executorFor(mode)
          if (!exec) return Effect.succeed("none" as const)
          return exec.healthCheck(component)
        }),

      healthCheckAll: Effect.gen(function* () {
        const [composeHealth, nativeHealth] = yield* Effect.all([
          composeExec.healthCheckAll,
          devExec.healthCheckAll,
        ])
        return { ...composeHealth, ...nativeHealth }
      }).pipe(Effect.withSpan("RoutingExecutor.healthCheckAll")),

      runProbe: (component, probe) =>
        Effect.flatMap(getMode(component), (mode) => {
          const exec = executorFor(mode)
          if (!exec) {
            return Effect.fail(
              new ProbeFailedError({
                component,
                probeType: "liveness",
                cause: `Component is externally managed (mode: ${mode})`,
              })
            )
          }
          return exec.runProbe(component, probe)
        }),
    }) satisfies IExecutor
  })
)
