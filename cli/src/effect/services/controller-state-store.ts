import { Context, Effect } from "effect"
import type { StateCorruptionError } from "@smp/factory-shared/effect/errors"
import type { SiteManifest } from "../../site/manifest.js"
import type { ImageHistoryEntry } from "../../site/state.js"

export type { ImageHistoryEntry }

export interface ControllerStateStoreService {
  readonly getLastManifest: Effect.Effect<SiteManifest | null>
  readonly saveManifest: (
    manifest: SiteManifest
  ) => Effect.Effect<void, StateCorruptionError>
  readonly recordImageDeploy: (
    component: string,
    image: string,
    version: number
  ) => Effect.Effect<void>
  readonly getPreviousImage: (component: string) => Effect.Effect<string | null>
  readonly getImageHistory: (
    component: string
  ) => Effect.Effect<ImageHistoryEntry[]>
  readonly getStartedAt: Effect.Effect<string>
}

export class ControllerStateStoreTag extends Context.Tag(
  "ControllerStateStore"
)<ControllerStateStoreTag, ControllerStateStoreService>() {}
