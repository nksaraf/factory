import { Effect, Layer } from "effect"
import { SiteConfigTag } from "../services/site-config.js"
import {
  AgentServerTag,
  type AgentServerService,
} from "../services/agent-server.js"

/**
 * @transitional Wraps the existing Elysia-based agent server.
 * The Elysia app stays as-is — this layer manages its lifecycle via Effect Scope.
 * Phase 8 will bridge individual routes to Effect services via ManagedRuntime.
 */
export const AgentServerLive = Layer.effect(
  AgentServerTag,
  Effect.gen(function* () {
    const config = yield* SiteConfigTag

    return AgentServerTag.of({
      start: Effect.gen(function* () {
        const { createAgentServer } = yield* Effect.tryPromise({
          try: () => import("../../site/agent-server.js"),
          catch: (e) => new Error(`Failed to import agent-server: ${e}`),
        }).pipe(Effect.orDie)

        const { SiteAgent } = yield* Effect.tryPromise({
          try: () => import("../../site/agent.js"),
          catch: (e) => new Error(`Failed to import agent: ${e}`),
        }).pipe(Effect.orDie)

        const agent = new SiteAgent({
          config: {
            mode: config.mode,
            port: config.port,
            workingDir: config.workingDir,
          },
          executor: null as any,
        })

        const server = createAgentServer(agent, { port: config.port })
        const serverInfo = yield* Effect.tryPromise({
          try: () => server.start(),
          catch: (e) => new Error(`Failed to start agent server: ${e}`),
        }).pipe(Effect.orDie)

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            try {
              server.stop()
            } catch {}
          })
        )

        return {
          port: serverInfo.port,
          stop: Effect.sync(() => {
            try {
              server.stop()
            } catch {}
          }),
        }
      }).pipe(Effect.withSpan("AgentServer.start")),
    }) satisfies AgentServerService
  })
)
