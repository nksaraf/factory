import { Effect, Layer } from "effect"
import { SiteConfigTag } from "../services/site-config.js"
import { SiteStateTag } from "../services/site-state.js"
import { DockerComposeOpsTag } from "../services/docker-compose-ops.js"
import {
  DependencyConnectorTag,
  type DependencyConnectorService,
  type ConnectionResult,
} from "../services/dependency-connector.js"
import { ConnectionError } from "../errors/site.js"

/**
 * @transitional Wraps the connection resolution logic from site-orchestrator.ts.
 * Phase 8 replaces this with a native Effect implementation.
 * Currently delegates to the SiteOrchestrator's resolveConnections/applyConnections
 * methods via a dynamically imported instance.
 */
export const DependencyConnectorLive = Layer.effect(
  DependencyConnectorTag,
  Effect.gen(function* () {
    const config = yield* SiteConfigTag
    const siteState = yield* SiteStateTag
    const composeOps = yield* DockerComposeOpsTag

    return DependencyConnectorTag.of({
      resolve: (flags) =>
        Effect.tryPromise({
          try: async () => {
            const { SiteOrchestrator } =
              await import("../../lib/site-orchestrator.js")
            const orch = await SiteOrchestrator.create({ quiet: true })
            const result = orch.resolveConnections(flags)
            if (!result) return null
            return {
              env: result.env,
              profileName: result.profileName,
              remoteDeps: result.remoteDeps,
            } satisfies ConnectionResult
          },
          catch: (error) =>
            new ConnectionError({
              profile: flags.connectTo ?? flags.profile ?? "unknown",
              cause: error instanceof Error ? error.message : String(error),
            }),
        }).pipe(Effect.withSpan("DependencyConnector.resolve")),

      apply: (conn, envPath, dryRun) =>
        Effect.tryPromise({
          try: async () => {
            const { SiteOrchestrator } =
              await import("../../lib/site-orchestrator.js")
            const orch = await SiteOrchestrator.create({ quiet: true })
            return orch.applyConnections(conn as any, envPath, dryRun)
          },
          catch: (error) =>
            new ConnectionError({
              profile: conn.profileName,
              cause: error instanceof Error ? error.message : String(error),
            }),
        }).pipe(Effect.withSpan("DependencyConnector.apply")),

      restoreLocal: (envPath) =>
        Effect.tryPromise({
          try: async () => {
            const { SiteOrchestrator } =
              await import("../../lib/site-orchestrator.js")
            const orch = await SiteOrchestrator.create({ quiet: true })
            orch.restoreLocalState(envPath)
          },
          catch: () => void 0 as never,
        }).pipe(
          Effect.catchAll(() => Effect.void),
          Effect.withSpan("DependencyConnector.restoreLocal")
        ),
    }) satisfies DependencyConnectorService
  })
)
