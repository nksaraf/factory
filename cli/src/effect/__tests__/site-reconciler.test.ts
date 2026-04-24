import { describe, test, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { SiteReconciler } from "../services/site-reconciler.js"
import { SiteReconcilerLive } from "../layers/site-reconciler.js"
import { SiteState, type ISiteState } from "../services/site-state.js"
import { SiteConfig } from "../services/site-config.js"
import {
  makeRecordingExecutor,
  makeTestSiteState,
  makeTestControllerStateStore,
  makeTestConfig,
} from "./test-layers"
import {
  makeManifest,
  makeRunningState,
  makeDevConfig,
  testCatalog,
} from "./fixtures"
import type { SiteManifest } from "../../site/manifest.js"

function buildReconcilerLayer(opts?: {
  inspectResult?: import("../services/executor.js").ComponentState[]
  failOnDeploy?: string[]
  manifest?: SiteManifest | null
}) {
  const executor = makeRecordingExecutor(opts)
  const stateStore = makeTestControllerStateStore()

  // SiteState that returns a manifest from toManifest
  const manifestToReturn =
    opts?.manifest !== undefined
      ? opts.manifest
      : makeManifest([{ componentName: "api" }])
  const baseSiteState = makeTestSiteState()
  const siteStateWithManifest = Layer.succeed(
    SiteState,
    SiteState.of({
      ...baseSiteState.layer.pipe(() => null as any), // unused
      getState: baseSiteState.layer as any,
      getSpec: Effect.succeed({
        site: { slug: "test" },
        workbench: { slug: "test" },
        mode: "dev" as const,
        systemDeployments: [],
      } as any),
      getStatus: Effect.succeed({
        phase: "pending" as const,
        conditions: [],
        updatedAt: "",
      } as any),
      getSystemDeployment: () => Effect.succeed(undefined),
      getComponentMode: (_, component) =>
        Effect.succeed(
          baseSiteState.componentModes.get(component)?.mode ?? null
        ),
      ensureSystemDeployment: (slug, systemSlug, runtime, composeFiles) =>
        Effect.succeed({
          slug,
          systemSlug,
          runtime,
          composeFiles,
          componentDeployments: [],
          resolvedEnv: {},
          tunnels: [],
        } as any),
      ensureLinkedSystemDeployment: (slug, systemSlug, linkedRef) =>
        Effect.succeed({ slug, systemSlug, linkedRef } as any),
      setComponentMode: (_, component, mode, o) => {
        baseSiteState.componentModes.set(component, { mode, opts: o })
        return Effect.void
      },
      updateComponentStatus: () => Effect.void,
      setCondition: (_, component, condition) => {
        const existing = baseSiteState.conditions.get(component) ?? []
        existing.push({ type: condition.type, status: condition.status })
        baseSiteState.conditions.set(component, existing)
        return Effect.void
      },
      setPhase: () => Effect.void,
      setResolvedEnv: () => Effect.void,
      bumpGeneration: (_, component) => {
        baseSiteState.generations.set(
          component,
          (baseSiteState.generations.get(component) ?? 0) + 1
        )
        return Effect.void
      },
      setMode: () => Effect.void,
      resetIntent: Effect.succeed(new Map()),
      restoreStatus: () => Effect.void,
      save: Effect.void,
      toManifest: () => Effect.succeed(manifestToReturn),
      init: () => Effect.void,
    })
  )

  const config = makeTestConfig(makeDevConfig())

  const layer = SiteReconcilerLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        config,
        executor.layer,
        siteStateWithManifest,
        stateStore.layer
      )
    )
  )

  return { executor, siteState: baseSiteState, stateStore, layer }
}

describe("SiteReconciler", () => {
  test("deploys new component not in actual", async () => {
    const { executor, layer } = buildReconcilerLayer({
      inspectResult: [],
      manifest: makeManifest([{ componentName: "api" }]),
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const reconciler = yield* SiteReconciler
        const result = yield* reconciler.reconcile

        expect(result.success).toBe(true)
        expect(result.stepsApplied).toBe(1)

        const deployCalls = executor.calls.filter((c) => c.method === "deploy")
        expect(deployCalls).toHaveLength(1)
        expect(deployCalls[0]!.args[0]).toBe("api")
      }).pipe(Effect.provide(layer))
    )
  })

  test("no steps when all components match", async () => {
    const { layer } = buildReconcilerLayer({
      inspectResult: [makeRunningState("api", "test/api:latest")],
      manifest: makeManifest([
        { componentName: "api", desiredImage: "test/api:latest" },
      ]),
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const reconciler = yield* SiteReconciler
        const result = yield* reconciler.reconcile

        expect(result.stepsApplied).toBe(0)
        expect(result.plan.upToDate).toContain("api")
      }).pipe(Effect.provide(layer))
    )
  })

  test("executor failure: error recorded, continues to next step", async () => {
    const { executor, layer } = buildReconcilerLayer({
      inspectResult: [],
      manifest: makeManifest([
        { componentName: "api" },
        { componentName: "web" },
      ]),
      failOnDeploy: ["api"],
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const reconciler = yield* SiteReconciler
        const result = yield* reconciler.reconcile

        expect(result.success).toBe(false)
        expect(result.errors).toHaveLength(1)
        expect(result.errors[0]!.step.component).toBe("api")
        expect(result.stepsApplied).toBe(1)

        const deployCalls = executor.calls.filter((c) => c.method === "deploy")
        expect(deployCalls).toHaveLength(2)
      }).pipe(Effect.provide(layer))
    )
  })

  test("sets Deployed condition on successful deploy", async () => {
    const { siteState, layer } = buildReconcilerLayer({
      inspectResult: [],
      manifest: makeManifest([{ componentName: "api" }]),
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const reconciler = yield* SiteReconciler
        yield* reconciler.reconcile

        const apiConditions = siteState.conditions.get("api")
        expect(apiConditions).toBeDefined()
        expect(
          apiConditions!.some(
            (c) => c.type === "Deployed" && c.status === "True"
          )
        ).toBe(true)
      }).pipe(Effect.provide(layer))
    )
  })

  test("does NOT set condition when deploy fails", async () => {
    const { siteState, layer } = buildReconcilerLayer({
      inspectResult: [],
      manifest: makeManifest([{ componentName: "api" }]),
      failOnDeploy: ["api"],
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const reconciler = yield* SiteReconciler
        yield* reconciler.reconcile

        const apiConditions = siteState.conditions.get("api")
        expect(apiConditions ?? []).toHaveLength(0)
      }).pipe(Effect.provide(layer))
    )
  })

  test("emits events: start → steps → complete", async () => {
    const { layer } = buildReconcilerLayer({
      inspectResult: [],
      manifest: makeManifest([{ componentName: "api" }]),
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const reconciler = yield* SiteReconciler
        yield* reconciler.reconcile

        const events = yield* reconciler.events.recent
        const types = events.map((e) => e.type)

        expect(types[0]).toBe("reconcile-start")
        expect(types[types.length - 1]).toBe("reconcile-complete")
        expect(types).toContain("step-applied")
      }).pipe(Effect.provide(layer))
    )
  })

  test("all events share same reconciliationId", async () => {
    const { layer } = buildReconcilerLayer({
      inspectResult: [],
      manifest: makeManifest([{ componentName: "api" }]),
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const reconciler = yield* SiteReconciler
        yield* reconciler.reconcile

        const events = yield* reconciler.events.recent
        const ids = new Set(events.map((e) => e.reconciliationId))
        expect(ids.size).toBe(1)
      }).pipe(Effect.provide(layer))
    )
  })

  test("lastResult updated after reconcile", async () => {
    const { layer } = buildReconcilerLayer({
      inspectResult: [],
      manifest: makeManifest([{ componentName: "api" }]),
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const reconciler = yield* SiteReconciler

        const before = yield* reconciler.lastResult
        expect(before).toBeNull()

        yield* reconciler.reconcile

        const after = yield* reconciler.lastResult
        expect(after).not.toBeNull()
        expect(after!.stepsApplied).toBe(1)
      }).pipe(Effect.provide(layer))
    )
  })

  test("null manifest (no SD) → empty result, no crash", async () => {
    const { layer } = buildReconcilerLayer({
      inspectResult: [],
      manifest: null,
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const reconciler = yield* SiteReconciler
        const result = yield* reconciler.reconcile

        expect(result.success).toBe(true)
        expect(result.stepsApplied).toBe(0)
        expect(result.stepsTotal).toBe(0)
      }).pipe(Effect.provide(layer))
    )
  })

  test("stop step calls executor.stop", async () => {
    const { executor, layer } = buildReconcilerLayer({
      inspectResult: [makeRunningState("api")],
      manifest: makeManifest([{ componentName: "api", status: "stopped" }]),
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const reconciler = yield* SiteReconciler
        yield* reconciler.reconcile

        const stopCalls = executor.calls.filter((c) => c.method === "stop")
        expect(stopCalls).toHaveLength(1)
        expect(stopCalls[0]!.args[0]).toBe("api")
      }).pipe(Effect.provide(layer))
    )
  })
})
