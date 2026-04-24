import { Context, Effect, Layer, Stream } from "effect"
import { ComposeExecutor } from "../../../site/execution/compose.js"
import { SiteConfig } from "../../services/site-config.js"
import type { IExecutor } from "../../services/executor.js"
import {
  ExecutorError,
  ComponentNotFoundError,
  ProbeFailedError,
} from "../../errors/site.js"
import { basename } from "node:path"

export class DockerComposeExecutor extends Context.Tag("DockerComposeExecutor")<
  DockerComposeExecutor,
  IExecutor
>() {}

function wrapPromise<T>(
  executor: string,
  operation: string,
  component: string,
  fn: () => Promise<T>
): Effect.Effect<T, ExecutorError> {
  return Effect.tryPromise({
    try: fn,
    catch: (error) =>
      new ExecutorError({
        executor,
        operation,
        component,
        cause: error instanceof Error ? error.message : String(error),
      }),
  })
}

export const DockerComposeExecutorLive = Layer.effect(
  DockerComposeExecutor,
  Effect.gen(function* () {
    const config = yield* SiteConfig
    const sys = config.focusSystem

    const impl = new ComposeExecutor({
      composeFiles: sys.composeFiles,
      projectName: basename(sys.rootDir),
      cwd: sys.rootDir,
    })

    return DockerComposeExecutor.of({
      type: "docker-compose",

      parseCatalog: wrapPromise("docker-compose", "parseCatalog", "*", () =>
        impl.parseCatalog()
      ),

      inspect: wrapPromise("docker-compose", "inspect", "*", () =>
        impl.inspect()
      ).pipe(Effect.withSpan("DockerComposeExecutor.inspect")),

      inspectOne: (component) =>
        wrapPromise("docker-compose", "inspectOne", component, () =>
          impl.inspectOne(component)
        ),

      deploy: (component, desired) =>
        wrapPromise("docker-compose", "deploy", component, () =>
          impl.deploy(component, desired)
        ).pipe(
          Effect.withSpan("DockerComposeExecutor.deploy", {
            attributes: {
              "component.name": component,
              "component.image": desired.image,
            },
          })
        ),

      stop: (component) =>
        wrapPromise("docker-compose", "stop", component, () =>
          impl.stop(component)
        ),

      scale: (component, replicas) =>
        wrapPromise("docker-compose", "scale", component, () =>
          impl.scale(component, replicas)
        ),

      restart: (component) =>
        wrapPromise("docker-compose", "restart", component, () =>
          impl.restart(component)
        ),

      runInit: (initName) =>
        wrapPromise("docker-compose", "runInit", initName, () =>
          impl.runInit(initName)
        ),

      logs: (component, opts) =>
        wrapPromise("docker-compose", "logs", component, () =>
          impl.logs(component, opts)
        ),

      logStream: (component, opts) =>
        Stream.fromEffect(
          wrapPromise("docker-compose", "logs", component, () =>
            impl.logs(component, opts)
          )
        ).pipe(Stream.flatMap((text) => Stream.fromIterable(text.split("\n")))),

      run: (component, cmd) =>
        wrapPromise("docker-compose", "run", component, () =>
          impl.run(component, cmd)
        ),

      healthCheck: (component) =>
        wrapPromise("docker-compose", "healthCheck", component, () =>
          impl.healthCheck(component)
        ),

      healthCheckAll: wrapPromise("docker-compose", "healthCheckAll", "*", () =>
        impl.healthCheckAll()
      ).pipe(Effect.withSpan("DockerComposeExecutor.healthCheckAll")),

      runProbe: (component, probe) =>
        Effect.fail(
          new ProbeFailedError({
            component,
            probeType: "liveness",
            cause:
              "Probe execution not yet implemented for docker-compose executor",
          })
        ),
    }) satisfies IExecutor
  })
)
