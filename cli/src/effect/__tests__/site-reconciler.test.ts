import { describe, test, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { SiteReconciler } from "../services/site-reconciler.js"
import { SiteReconcilerLive } from "../layers/site-reconciler.js"
import { SiteConfig } from "../services/site-config.js"
import {
  makeRecordingExecutor,
  makeTestSiteState,
  makeTestControllerStateStore,
  makeTestConfig,
} from "./test-layers"
import { makeManifest, makeRunningState, makeDevConfig } from "./fixtures"

function buildReconcilerLayer(opts?: {
  inspectResult?: import("../services/executor.js").ComponentState[]
  failOnDeploy?: string[]
}) {
  const executor = makeRecordingExecutor(opts)
  const siteState = makeTestSiteState()
  const stateStore = makeTestControllerStateStore()
  const config = makeTestConfig(makeDevConfig())

  const layer = SiteReconcilerLive.pipe(
    Layer.provide(
      Layer.mergeAll(config, executor.layer, siteState.layer, stateStore.layer)
    )
  )

  return { executor, siteState, stateStore, layer }
}

describe("SiteReconciler", () => {
  describe("reconcileOnce", () => {
    test("deploys new component not in actual", async () => {
      const manifest = makeManifest([{ componentName: "api" }])
      const { executor, siteState, layer } = buildReconcilerLayer({
        inspectResult: [],
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const reconciler = yield* SiteReconciler
          const result = yield* reconciler.reconcileOnce(manifest)

          expect(result.success).toBe(true)
          expect(result.stepsApplied).toBe(1)
          expect(result.stepsTotal).toBe(1)
          expect(result.errors).toHaveLength(0)

          const deployCalls = executor.calls.filter(
            (c) => c.method === "deploy"
          )
          expect(deployCalls).toHaveLength(1)
          expect(deployCalls[0]!.args[0]).toBe("api")
        }).pipe(Effect.provide(layer))
      )
    })

    test("no steps when all components match", async () => {
      const manifest = makeManifest([
        { componentName: "api", desiredImage: "test/api:latest" },
      ])
      const { layer } = buildReconcilerLayer({
        inspectResult: [makeRunningState("api", "test/api:latest")],
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const reconciler = yield* SiteReconciler
          const result = yield* reconciler.reconcileOnce(manifest)

          expect(result.stepsApplied).toBe(0)
          expect(result.stepsTotal).toBe(0)
          expect(result.plan.upToDate).toContain("api")
        }).pipe(Effect.provide(layer))
      )
    })

    test("executor failure on one step: error recorded, continues to next", async () => {
      const manifest = makeManifest([
        { componentName: "api" },
        { componentName: "web" },
      ])
      const { executor, layer } = buildReconcilerLayer({
        inspectResult: [],
        failOnDeploy: ["api"],
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const reconciler = yield* SiteReconciler
          const result = yield* reconciler.reconcileOnce(manifest)

          expect(result.success).toBe(false)
          expect(result.errors).toHaveLength(1)
          expect(result.errors[0]!.step.component).toBe("api")
          expect(result.stepsApplied).toBe(1)

          const deployCalls = executor.calls.filter(
            (c) => c.method === "deploy"
          )
          expect(deployCalls).toHaveLength(2)
        }).pipe(Effect.provide(layer))
      )
    })

    test("sets Deployed condition on successful deploy", async () => {
      const manifest = makeManifest([{ componentName: "api" }])
      const { siteState, layer } = buildReconcilerLayer({
        inspectResult: [],
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const reconciler = yield* SiteReconciler
          yield* reconciler.reconcileOnce(manifest)

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
      const manifest = makeManifest([{ componentName: "api" }])
      const { siteState, layer } = buildReconcilerLayer({
        inspectResult: [],
        failOnDeploy: ["api"],
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const reconciler = yield* SiteReconciler
          yield* reconciler.reconcileOnce(manifest)

          const apiConditions = siteState.conditions.get("api")
          expect(apiConditions ?? []).toHaveLength(0)
        }).pipe(Effect.provide(layer))
      )
    })

    test("emits events in order: start → steps → complete", async () => {
      const manifest = makeManifest([{ componentName: "api" }])
      const { layer } = buildReconcilerLayer({ inspectResult: [] })

      await Effect.runPromise(
        Effect.gen(function* () {
          const reconciler = yield* SiteReconciler
          yield* reconciler.reconcileOnce(manifest)

          const events = yield* reconciler.events.recent
          const types = events.map((e) => e.type)

          expect(types[0]).toBe("reconcile-start")
          expect(types[types.length - 1]).toBe("reconcile-complete")
          expect(types).toContain("step-applied")
        }).pipe(Effect.provide(layer))
      )
    })

    test("all events share the same reconciliationId", async () => {
      const manifest = makeManifest([{ componentName: "api" }])
      const { layer } = buildReconcilerLayer({ inspectResult: [] })

      await Effect.runPromise(
        Effect.gen(function* () {
          const reconciler = yield* SiteReconciler
          yield* reconciler.reconcileOnce(manifest)

          const events = yield* reconciler.events.recent
          const ids = new Set(events.map((e) => e.reconciliationId))
          expect(ids.size).toBe(1)
        }).pipe(Effect.provide(layer))
      )
    })

    test("lastResult is updated after reconcile", async () => {
      const manifest = makeManifest([{ componentName: "api" }])
      const { layer } = buildReconcilerLayer({ inspectResult: [] })

      await Effect.runPromise(
        Effect.gen(function* () {
          const reconciler = yield* SiteReconciler

          const before = yield* reconciler.lastResult
          expect(before).toBeNull()

          yield* reconciler.reconcileOnce(manifest)

          const after = yield* reconciler.lastResult
          expect(after).not.toBeNull()
          expect(after!.stepsApplied).toBe(1)
        }).pipe(Effect.provide(layer))
      )
    })
  })

  describe("reconcile (reads from store)", () => {
    test("no manifest in store → ManifestError", async () => {
      const { layer } = buildReconcilerLayer()

      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const reconciler = yield* SiteReconciler
          yield* reconciler.reconcile
        }).pipe(Effect.provide(layer))
      )

      expect(exit._tag).toBe("Failure")
    })

    test("manifest in store → delegates to reconcileOnce", async () => {
      const manifest = makeManifest([{ componentName: "api" }])
      const stateStore = makeTestControllerStateStore()

      // Pre-populate the store with a manifest
      await Effect.runPromise(
        Effect.gen(function* () {
          const store = yield* ControllerStateStore
          yield* store.saveManifest(manifest)
        }).pipe(Effect.provide(stateStore.layer))
      )

      const executor = makeRecordingExecutor({ inspectResult: [] })
      const siteState = makeTestSiteState()
      const config = makeTestConfig(makeDevConfig())

      const layer = SiteReconcilerLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            config,
            executor.layer,
            siteState.layer,
            stateStore.layer
          )
        )
      )

      await Effect.runPromise(
        Effect.gen(function* () {
          const reconciler = yield* SiteReconciler
          const result = yield* reconciler.reconcile

          expect(result.stepsApplied).toBe(1)
        }).pipe(Effect.provide(layer))
      )
    })
  })

  describe("executeStep edge cases", () => {
    test("stop step calls executor.stop", async () => {
      const manifest = makeManifest([
        { componentName: "api", status: "stopped" },
      ])
      const { executor, layer } = buildReconcilerLayer({
        inspectResult: [makeRunningState("api")],
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const reconciler = yield* SiteReconciler
          yield* reconciler.reconcileOnce(manifest)

          const stopCalls = executor.calls.filter((c) => c.method === "stop")
          expect(stopCalls).toHaveLength(1)
          expect(stopCalls[0]!.args[0]).toBe("api")
        }).pipe(Effect.provide(layer))
      )
    })
  })
})

import { ControllerStateStore } from "../services/controller-state-store.js"
