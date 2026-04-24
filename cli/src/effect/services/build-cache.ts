import { Context, Effect } from "effect"
import type { CatalogSystem } from "@smp/factory-shared/catalog"
import type { BuildCheckResult } from "../../lib/build-cache.js"

export type { BuildCheckResult }

export interface IBuildCache {
  readonly check: (
    catalog: CatalogSystem,
    services: string[]
  ) => Effect.Effect<BuildCheckResult>
  readonly record: (
    catalog: CatalogSystem,
    services: string[]
  ) => Effect.Effect<void>
}

export class BuildCache extends Context.Tag("BuildCache")<
  BuildCache,
  IBuildCache
>() {}
