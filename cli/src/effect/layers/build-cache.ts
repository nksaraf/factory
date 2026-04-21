import { Effect, Layer } from "effect"
import { checkBuildStatus, recordBuild } from "../../lib/build-cache.js"
import { SiteConfigTag } from "../services/site-config.js"
import {
  BuildCacheTag,
  type BuildCacheService,
} from "../services/build-cache.js"

export const BuildCacheLive = Layer.effect(
  BuildCacheTag,
  Effect.gen(function* () {
    const config = yield* SiteConfigTag
    const rootDir = config.focusSystem.rootDir

    return BuildCacheTag.of({
      check: (catalog, services) =>
        Effect.sync(() => checkBuildStatus(rootDir, catalog, services)),

      record: (catalog, services) =>
        Effect.sync(() => recordBuild(rootDir, catalog, services)),
    }) satisfies BuildCacheService
  })
)
