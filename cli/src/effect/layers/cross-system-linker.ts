import { Effect, Layer } from "effect"
import { resolveLinkedSystemDeployments } from "../../lib/linked-sd-resolver.js"
import { SiteConfigTag } from "../services/site-config.js"
import { SiteStateTag } from "../services/site-state.js"
import {
  CrossSystemLinkerTag,
  type CrossSystemLinkerService,
  type CrossSystemLink,
} from "../services/cross-system-linker.js"

export const CrossSystemLinkerLive = Layer.effect(
  CrossSystemLinkerTag,
  Effect.gen(function* () {
    const config = yield* SiteConfigTag
    const siteState = yield* SiteStateTag

    return CrossSystemLinkerTag.of({
      resolve: (opts) =>
        Effect.sync(() => {
          const linkedSds = resolveLinkedSystemDeployments({
            connects: opts.connects,
            connectTo: opts.connectTo,
            catalog: config.focusSystem.catalog,
            endpointsBySystem: {} as Record<string, any>,
          })

          return linkedSds.map(
            (l) =>
              ({
                slug: l.slug,
                systemSlug: l.systemSlug,
                linkedRef: l.linkedRef,
                env: l.env,
              }) satisfies CrossSystemLink
          )
        }).pipe(Effect.withSpan("CrossSystemLinker.resolve")),

      apply: (links, connectionEnv) =>
        Effect.gen(function* () {
          const crossSystemEnv: Record<string, string> = {}
          for (const l of links) {
            Object.assign(crossSystemEnv, l.env)
          }

          const merged = { ...crossSystemEnv }
          for (const [k, v] of Object.entries(connectionEnv)) {
            merged[k] = v
          }

          for (const l of links) {
            yield* siteState.ensureLinkedSystemDeployment(
              l.slug,
              l.systemSlug,
              l.linkedRef
            )
          }

          if (links.length > 0) {
            yield* siteState.save.pipe(Effect.catchAll(() => Effect.void))
          }

          return merged
        }).pipe(Effect.withSpan("CrossSystemLinker.apply")),
    }) satisfies CrossSystemLinkerService
  })
)
