import { Context, Effect, PubSub } from "effect"
import type { SiteManifest } from "../../site/manifest.js"
import type { ReconcilePlan, ReconcileStep } from "../../site/reconcile.js"
import type { ComponentState } from "../../site/execution/executor.js"
import type { ExecutorError, ManifestError } from "../errors/site.js"
import type { EventJournal } from "@smp/factory-shared/effect/event-journal"

export interface ReconcileResult {
  readonly success: boolean
  readonly stepsApplied: number
  readonly stepsTotal: number
  readonly errors: ReadonlyArray<{
    readonly step: ReconcileStep
    readonly error: string
  }>
  readonly plan: ReconcilePlan
  readonly durationMs: number
  readonly reconciliationId: string
}

export interface ReconcileEvent {
  readonly timestamp: string
  readonly reconciliationId: string
  readonly type:
    | "reconcile-start"
    | "reconcile-complete"
    | "reconcile-error"
    | "step-applied"
    | "step-failed"
    | "condition-set"
  readonly details: Record<string, unknown>
}

export interface ISiteReconciler {
  readonly planChanges: (
    manifest: SiteManifest,
    actual: ComponentState[]
  ) => Effect.Effect<ReconcilePlan>
  readonly executeStep: (
    step: ReconcileStep
  ) => Effect.Effect<
    void,
    ExecutorError | import("../errors/site.js").FinalizerTimeoutError
  >
  readonly reconcileOnce: (
    manifest: SiteManifest
  ) => Effect.Effect<ReconcileResult, ExecutorError>
  readonly reconcile: Effect.Effect<
    ReconcileResult,
    ExecutorError | ManifestError
  >
  readonly events: EventJournal<ReconcileEvent>
  readonly lastResult: Effect.Effect<ReconcileResult | null>
}

export class SiteReconciler extends Context.Tag("SiteReconciler")<
  SiteReconciler,
  ISiteReconciler
>() {}
