import { Context, Effect, Layer, Stream } from "effect"
import { NativeExecutor } from "../../../site/execution/native.js"
import { SiteConfig } from "../../services/site-config.js"
import { SiteState } from "../../services/site-state.js"
import type { IExecutor } from "../../services/executor.js"
import { ExecutorError, ProbeFailedError } from "../../errors/site.js"
import { SiteManager } from "../../../lib/site-manager.js"

export class DevProcessExecutor extends Context.Tag("DevProcessExecutor")<
  DevProcessExecutor,
  IExecutor
>() {}

function wrapPromise<T>(
  operation: string,
  component: string,
  fn: () => Promise<T>
): Effect.Effect<T, ExecutorError> {
  return Effect.tryPromise({
    try: fn,
    catch: (error) =>
      new ExecutorError({
        executor: "dev-process",
        operation,
        component,
        cause: error instanceof Error ? error.message : String(error),
      }),
  })
}

export const DevProcessExecutorLive = Layer.effect(
  DevProcessExecutor,
  Effect.gen(function* () {
    const config = yield* SiteConfig
    const siteState = yield* SiteState
    const sys = config.focusSystem

    /**
     * @transitional NativeExecutor requires a SiteManager instance that it
     * mutates directly (updateComponentStatus, save). This creates a dual-write:
     * NativeExecutor writes to disk via its own SiteManager, bypassing SiteState.
     * Phase 8 replaces this with a native Effect implementation using SiteState.
     */
    const state = yield* siteState.getState
    const manager =
      SiteManager.load(config.workingDir) ??
      SiteManager.init(
        config.workingDir,
        state.spec.site,
        state.spec.workbench,
        state.spec.mode
      )

    const impl = new NativeExecutor({
      rootDir: sys.rootDir,
      catalog: sys.catalog,
      site: manager,
      sdSlug: sys.sdSlug,
    })

    return DevProcessExecutor.of({
      type: "dev-process",

      parseCatalog: wrapPromise("parseCatalog", "*", () => impl.parseCatalog()),

      inspect: wrapPromise("inspect", "*", () => impl.inspect()).pipe(
        Effect.withSpan("DevProcessExecutor.inspect")
      ),

      inspectOne: (component) =>
        wrapPromise("inspectOne", component, () => impl.inspectOne(component)),

      deploy: (component, desired) =>
        wrapPromise("deploy", component, () =>
          impl.deploy(component, desired)
        ).pipe(
          Effect.withSpan("DevProcessExecutor.deploy", {
            attributes: { "component.name": component },
          })
        ),

      stop: (component) =>
        wrapPromise("stop", component, () => impl.stop(component)),

      scale: (component, replicas) =>
        wrapPromise("scale", component, () => impl.scale(component, replicas)),

      restart: (component) =>
        wrapPromise("restart", component, () => impl.restart(component)),

      runInit: (initName) =>
        wrapPromise("runInit", initName, () => impl.runInit(initName)),

      logs: (component, opts) =>
        wrapPromise("logs", component, () => impl.logs(component, opts)),

      logStream: (component, opts) =>
        Stream.fromEffect(
          wrapPromise("logs", component, () => impl.logs(component, opts))
        ).pipe(Stream.flatMap((text) => Stream.fromIterable(text.split("\n")))),

      run: (component, cmd) =>
        wrapPromise("run", component, () => impl.run(component, cmd)),

      healthCheck: (component) =>
        wrapPromise("healthCheck", component, () =>
          impl.healthCheck(component)
        ),

      healthCheckAll: wrapPromise("healthCheckAll", "*", () =>
        impl.healthCheckAll()
      ).pipe(Effect.withSpan("DevProcessExecutor.healthCheckAll")),

      runProbe: (component, probe) =>
        Effect.fail(
          new ProbeFailedError({
            component,
            probeType: "liveness",
            cause:
              "Probe execution not yet implemented for dev-process executor",
          })
        ),
    }) satisfies IExecutor
  })
)
