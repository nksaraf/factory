import { Context, Effect } from "effect"
import type { CatalogSystem } from "@smp/factory-shared/catalog"
import type { BuildCheckResult } from "../../lib/build-cache.js"

export type { BuildCheckResult }

export interface BuildCacheService {
  readonly check: (
    catalog: CatalogSystem,
    services: string[]
  ) => Effect.Effect<BuildCheckResult>
  readonly record: (
    catalog: CatalogSystem,
    services: string[]
  ) => Effect.Effect<void>
}

export class BuildCacheTag extends Context.Tag("BuildCache")<
  BuildCacheTag,
  BuildCacheService
>() {}
