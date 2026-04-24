import { Effect, Layer, Ref } from "effect"
import { SiteConfig } from "../services/site-config.js"
import { SiteState } from "../services/site-state.js"
import { DockerComposeOps } from "../services/docker-compose-ops.js"
import {
  DependencyConnector,
  type IDependencyConnector,
  type ConnectionResult,
} from "../services/dependency-connector.js"
import { ConnectionError } from "../errors/site.js"

/**
 * @transitional Wraps the connection resolution logic from site-orchestrator.ts.
 * Creates a single SiteOrchestrator lazily on first use and reuses it.
 * Phase 8 replaces with native Effect implementation.
 */
export const DependencyConnectorLive = Layer.effect(
  DependencyConnector,
  Effect.gen(function* () {
    const config = yield* SiteConfig
    const siteState = yield* SiteState
    const composeOps = yield* DockerComposeOps

    type Orch = import("../../lib/site-orchestrator.js").SiteOrchestrator
    const orchRef = yield* Ref.make<Orch | null>(null)

    const getOrch = Effect.gen(function* () {
      const cached = yield* Ref.get(orchRef)
      if (cached) return cached
      const orch = yield* Effect.tryPromise({
        try: async () => {
          const { SiteOrchestrator } =
            await import("../../lib/site-orchestrator.js")
          return SiteOrchestrator.create({ quiet: true })
        },
        catch: (error) =>
          new ConnectionError({
            profile: "unknown",
            cause: `Failed to create orchestrator: ${error instanceof Error ? error.message : String(error)}`,
          }),
      })
      yield* Ref.set(orchRef, orch)
      return orch
    })

    return DependencyConnector.of({
      resolve: (flags) =>
        Effect.gen(function* () {
          const orch = yield* getOrch
          const result = orch.resolveConnections(flags)
          if (!result) return null
          return {
            env: result.env,
            profileName: result.profileName,
            remoteDeps: result.remoteDeps,
          } satisfies ConnectionResult
        }).pipe(
          Effect.catchAllDefect((error) =>
            Effect.fail(
              new ConnectionError({
                profile: flags.connectTo ?? flags.profile ?? "unknown",
                cause: error instanceof Error ? error.message : String(error),
              })
            )
          ),
          Effect.withSpan("DependencyConnector.resolve")
        ),

      apply: (conn, envPath, dryRun) =>
        Effect.gen(function* () {
          const orch = yield* getOrch
          return orch.applyConnections(conn as any, envPath, dryRun)
        }).pipe(
          Effect.catchAllDefect((error) =>
            Effect.fail(
              new ConnectionError({
                profile: conn.profileName,
                cause: error instanceof Error ? error.message : String(error),
              })
            )
          ),
          Effect.withSpan("DependencyConnector.apply")
        ),

      restoreLocal: (envPath) =>
        Effect.gen(function* () {
          const orch = yield* getOrch
          orch.restoreLocalState(envPath)
        }).pipe(
          Effect.catchAll(() => Effect.void),
          Effect.catchAllDefect(() => Effect.void),
          Effect.withSpan("DependencyConnector.restoreLocal")
        ),
    }) satisfies IDependencyConnector
  })
)
