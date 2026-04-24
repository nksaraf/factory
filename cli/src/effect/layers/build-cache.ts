import { Effect, Layer } from "effect"
import { checkBuildStatus, recordBuild } from "../../lib/build-cache.js"
import { SiteConfig } from "../services/site-config.js"
import { BuildCache, type IBuildCache } from "../services/build-cache.js"

export const BuildCacheLive = Layer.effect(
  BuildCache,
  Effect.gen(function* () {
    const config = yield* SiteConfig
    const rootDir = config.focusSystem.rootDir

    return BuildCache.of({
      check: (catalog, services) =>
        Effect.sync(() => checkBuildStatus(rootDir, catalog, services)),

      record: (catalog, services) =>
        Effect.sync(() => recordBuild(rootDir, catalog, services)),
    }) satisfies IBuildCache
  })
)
