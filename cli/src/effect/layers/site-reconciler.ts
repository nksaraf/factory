import { Effect, Layer, Ref } from "effect"
import { randomUUID } from "node:crypto"
import { planChanges } from "../../site/reconcile.js"
import { ExecutorTag } from "../services/executor.js"
import { SiteStateTag } from "../services/site-state.js"
import { ControllerStateStoreTag } from "../services/controller-state-store.js"
import {
  SiteReconcilerTag,
  type SiteReconcilerService,
  type ReconcileResult,
  type ReconcileEvent,
} from "../services/site-reconciler.js"
import { ManifestError } from "../errors/site.js"
import { makeEventJournal } from "@smp/factory-shared/effect/event-journal"

export const SiteReconcilerLive = Layer.effect(
  SiteReconcilerTag,
  Effect.gen(function* () {
    const executor = yield* ExecutorTag
    const siteState = yield* SiteStateTag
    const stateStore = yield* ControllerStateStoreTag
    const journal = yield* makeEventJournal<ReconcileEvent>({ maxSize: 200 })
    const lastResultRef = yield* Ref.make<ReconcileResult | null>(null)

    function emitEvent(
      reconciliationId: string,
      type: ReconcileEvent["type"],
      details: Record<string, unknown>
    ) {
      return journal.emit({
        timestamp: new Date().toISOString(),
        reconciliationId,
        type,
        details,
      })
    }

    const executeStep = (
      step: import("../../site/reconcile.js").ReconcileStep
    ) =>
      Effect.gen(function* () {
        switch (step.action) {
          case "run-init":
            yield* executor.runInit(step.component)
            break
          case "deploy":
            if (step.desired) {
              const result = yield* executor.deploy(step.component, {
                image: step.desired.desiredImage,
                replicas: step.desired.replicas,
                envOverrides: step.desired.envOverrides,
                resourceOverrides: {},
              })
              yield* stateStore.recordImageDeploy(
                step.component,
                result.actualImage,
                0
              )
              yield* siteState.setCondition("", step.component, {
                type: "Deployed",
                status: "True",
                reason: "DeploySucceeded",
                lastTransitionTime: new Date().toISOString(),
              })
            }
            break
          case "scale":
            if (step.replicas !== undefined) {
              yield* executor.scale(step.component, step.replicas)
            }
            break
          case "stop":
            yield* executor.stop(step.component)
            break
          case "restart":
            yield* executor.restart(step.component)
            break
        }
      }).pipe(
        Effect.withSpan("SiteReconciler.executeStep", {
          attributes: {
            "step.action": step.action,
            "step.component": step.component,
          },
        })
      )

    const reconcileOnceImpl = (
      manifest: import("../../site/manifest.js").SiteManifest
    ) =>
      Effect.gen(function* () {
        const reconciliationId = randomUUID()
        const start = performance.now()

        yield* emitEvent(reconciliationId, "reconcile-start", {
          manifestVersion: manifest.version,
        })

        const actual = yield* executor.inspect
        const plan = planChanges(manifest, actual)
        const errors: Array<{
          step: import("../../site/reconcile.js").ReconcileStep
          error: string
        }> = []
        let applied = 0

        for (const step of plan.steps) {
          const exit = yield* Effect.exit(executeStep(step))
          if (exit._tag === "Success") {
            applied++
            yield* emitEvent(reconciliationId, "step-applied", {
              action: step.action,
              component: step.component,
            })
          } else {
            const msg = String(exit.cause)
            errors.push({ step, error: msg })
            yield* emitEvent(reconciliationId, "step-failed", {
              action: step.action,
              component: step.component,
              error: msg,
            })
          }
        }

        const durationMs = performance.now() - start
        const result: ReconcileResult = {
          success: errors.length === 0,
          stepsApplied: applied,
          stepsTotal: plan.steps.length,
          errors,
          plan,
          durationMs,
          reconciliationId,
        }

        yield* Ref.set(lastResultRef, result)
        yield* emitEvent(reconciliationId, "reconcile-complete", {
          applied,
          errors: errors.length,
          durationMs,
        })

        return result
      }).pipe(Effect.withSpan("SiteReconciler.reconcileOnce"))

    return SiteReconcilerTag.of({
      planChanges: (manifest, actual) =>
        Effect.sync(() => planChanges(manifest, actual)),

      executeStep,

      reconcileOnce: reconcileOnceImpl,

      reconcile: Effect.gen(function* () {
        const manifest = yield* stateStore.getLastManifest
        if (!manifest) {
          return yield* Effect.fail(
            new ManifestError({ reason: "No manifest available" })
          )
        }
        return yield* reconcileOnceImpl(manifest)
      }),

      events: journal,

      lastResult: Ref.get(lastResultRef),
    }) satisfies SiteReconcilerService
  })
)
