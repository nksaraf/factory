import { Effect, Layer, Ref } from "effect"
import { StateCorruptionError } from "@smp/factory-shared/effect/errors"
import { SiteManager } from "../../lib/site-manager.js"
import { SiteState, type ISiteState } from "../services/site-state.js"
import { SiteConfig } from "../services/site-config.js"
import { join } from "node:path"

function persistSiteJson(
  rootDir: string,
  manager: SiteManager
): Effect.Effect<void, StateCorruptionError> {
  return Effect.try({
    try: () => manager.save(),
    catch: (error) =>
      new StateCorruptionError({
        path: join(rootDir, ".dx", "site.json"),
        cause: error instanceof Error ? error.message : String(error),
      }),
  })
}

/**
 * @transitional Wraps mutable SiteManager via Ref<SiteManager>.
 * The Ref protects the reference, NOT the internal mutable state.
 * Concurrent fibers mutating the same manager instance can race.
 * Acceptable during coexistence (daemon is single-threaded in practice).
 * Phase 8 replaces this with ConfigStore<SiteStateData> + immutable Ref.update.
 */
export const SiteStateLive = Layer.effect(
  SiteState,
  Effect.gen(function* () {
    const config = yield* SiteConfig
    const rootDir = config.workingDir

    const existing = SiteManager.load(rootDir)
    const managerRef = yield* Ref.make<SiteManager | null>(existing)

    const getManager = Effect.gen(function* () {
      const mgr = yield* Ref.get(managerRef)
      if (!mgr) {
        return yield* Effect.die(
          new Error(
            "SiteState not initialized — call init() first or ensure site.json exists"
          )
        )
      }
      return mgr
    })

    const service: ISiteState = {
      getState: Effect.flatMap(getManager, (m) =>
        Effect.sync(() => m.getState())
      ),
      getSpec: Effect.flatMap(getManager, (m) =>
        Effect.sync(() => m.getState().spec)
      ),
      getStatus: Effect.flatMap(getManager, (m) =>
        Effect.sync(() => m.getState().status)
      ),

      getSystemDeployment: (slug) =>
        Effect.flatMap(getManager, (m) =>
          Effect.sync(() => m.getSystemDeployment(slug))
        ),

      getComponentMode: (sdSlug, component) =>
        Effect.flatMap(getManager, (m) =>
          Effect.sync(() => m.getComponentMode(sdSlug, component))
        ),

      ensureSystemDeployment: (slug, systemSlug, runtime, composeFiles) =>
        Effect.flatMap(getManager, (m) =>
          Effect.sync(() =>
            m.ensureSystemDeployment(slug, systemSlug, runtime, composeFiles)
          )
        ),

      ensureLinkedSystemDeployment: (slug, systemSlug, linkedRef) =>
        Effect.flatMap(getManager, (m) =>
          Effect.sync(() =>
            m.ensureLinkedSystemDeployment(slug, systemSlug, linkedRef)
          )
        ),

      setComponentMode: (sdSlug, component, mode, opts) =>
        Effect.flatMap(getManager, (m) =>
          Effect.sync(() => m.setComponentMode(sdSlug, component, mode, opts))
        ),

      updateComponentStatus: (sdSlug, component, status) =>
        Effect.flatMap(getManager, (m) =>
          Effect.sync(() => m.updateComponentStatus(sdSlug, component, status))
        ),

      setCondition: (sdSlug, component, condition) =>
        Effect.flatMap(getManager, (m) =>
          Effect.sync(() => m.setCondition(sdSlug, component, condition))
        ),

      setPhase: (phase) =>
        Effect.flatMap(getManager, (m) => Effect.sync(() => m.setPhase(phase))),

      setResolvedEnv: (sdSlug, env, tunnels) =>
        Effect.flatMap(getManager, (m) =>
          Effect.sync(() => m.setResolvedEnv(sdSlug, env, tunnels))
        ),

      bumpGeneration: (sdSlug, component) =>
        Effect.flatMap(getManager, (m) =>
          Effect.sync(() => m.bumpGeneration(sdSlug, component))
        ),

      setMode: (mode) =>
        Effect.flatMap(getManager, (m) => Effect.sync(() => m.setMode(mode))),

      resetIntent: Effect.flatMap(getManager, (m) =>
        Effect.sync(() => m.resetIntent())
      ),

      restoreStatus: (sdSlug, component, saved) =>
        Effect.flatMap(getManager, (m) =>
          Effect.sync(() => m.restoreStatus(sdSlug, component, saved))
        ),

      save: Effect.flatMap(getManager, (m) => persistSiteJson(rootDir, m)).pipe(
        Effect.withSpan("SiteState.save", { attributes: { rootDir } })
      ),

      toManifest: (sdSlug, catalog) =>
        Effect.flatMap(getManager, (m) =>
          Effect.sync(() => m.toManifest(sdSlug, catalog))
        ),

      init: (site, workbench, mode) =>
        Effect.gen(function* () {
          const mgr = SiteManager.init(rootDir, site, workbench, mode)
          yield* Ref.set(managerRef, mgr)
        }),
    }

    return service
  })
)
