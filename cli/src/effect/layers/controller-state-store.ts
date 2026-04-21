import { Effect, Layer } from "effect"
import { StateCorruptionError } from "@smp/factory-shared/effect/errors"
import { StateStore } from "../../site/state.js"
import {
  ControllerStateStoreTag,
  type ControllerStateStoreService,
} from "../services/controller-state-store.js"
import { SiteConfigTag } from "../services/site-config.js"
import { join } from "node:path"

export const ControllerStateStoreLive = Layer.effect(
  ControllerStateStoreTag,
  Effect.gen(function* () {
    const config = yield* SiteConfigTag
    const stateDir = join(config.workingDir, ".dx")
    const store = new StateStore(stateDir)

    return ControllerStateStoreTag.of({
      getLastManifest: Effect.sync(() => store.getLastManifest()),

      saveManifest: (manifest) =>
        Effect.try({
          try: () => store.saveManifest(manifest),
          catch: (error) =>
            new StateCorruptionError({
              path: join(stateDir, "controller-state.json"),
              cause: error instanceof Error ? error.message : String(error),
            }),
        }).pipe(Effect.withSpan("ControllerStateStore.saveManifest")),

      recordImageDeploy: (component, image, version) =>
        Effect.try({
          try: () => store.recordImageDeploy(component, image, version),
          catch: (error) =>
            new StateCorruptionError({
              path: join(stateDir, "controller-state.json"),
              cause: error instanceof Error ? error.message : String(error),
            }),
        }).pipe(Effect.catchAll(() => Effect.void)),

      getPreviousImage: (component) =>
        Effect.sync(() => store.getPreviousImage(component)),

      getImageHistory: (component) =>
        Effect.sync(() => store.getImageHistory(component)),

      getStartedAt: Effect.sync(() => store.getStartedAt()),
    }) satisfies ControllerStateStoreService
  })
)
