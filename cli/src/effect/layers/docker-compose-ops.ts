import { Effect, Layer } from "effect"
import { Compose, isDockerRunning } from "../../lib/docker.js"
import { SiteConfigTag } from "../services/site-config.js"
import {
  DockerComposeOpsTag,
  type DockerComposeOpsService,
} from "../services/docker-compose-ops.js"
import { ExecutorError, BuildError } from "../errors/site.js"
import { basename } from "node:path"

export const DockerComposeOpsLive = Layer.effect(
  DockerComposeOpsTag,
  Effect.gen(function* () {
    const config = yield* SiteConfigTag
    const sys = config.focusSystem

    const compose =
      sys.composeFiles.length > 0
        ? new Compose(sys.composeFiles, basename(sys.rootDir))
        : null

    return DockerComposeOpsTag.of({
      build: (services) =>
        Effect.try({
          try: () => {
            if (!compose) return
            compose.build(services)
          },
          catch: (error) =>
            new BuildError({
              component: services.join(", "),
              cause: error instanceof Error ? error.message : String(error),
            }),
        }).pipe(
          Effect.withSpan("DockerComposeOps.build", {
            attributes: { "compose.services": services.join(",") },
          })
        ),

      stop: (services) =>
        Effect.try({
          try: () => {
            if (!compose) return
            compose.stop(services)
          },
          catch: (error) =>
            new ExecutorError({
              executor: "docker-compose",
              operation: "stop",
              component: services.join(", "),
              cause: error instanceof Error ? error.message : String(error),
            }),
        }).pipe(
          Effect.withSpan("DockerComposeOps.stop", {
            attributes: { "compose.services": services.join(",") },
          })
        ),

      up: (opts) =>
        Effect.try({
          try: () => {
            if (!compose) return
            compose.up(opts)
          },
          catch: (error) =>
            new ExecutorError({
              executor: "docker-compose",
              operation: "up",
              component: opts.services?.join(", ") ?? "all",
              cause: error instanceof Error ? error.message : String(error),
            }),
        }).pipe(
          Effect.withSpan("DockerComposeOps.up", {
            attributes: {
              "compose.services": opts.services?.join(",") ?? "all",
              "compose.detach": String(opts.detach ?? true),
            },
          })
        ),

      isDockerRunning: Effect.sync(() => isDockerRunning()),
    }) satisfies DockerComposeOpsService
  })
)
