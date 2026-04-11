import type {
  ReconcileContext,
  ReconcileResult,
  ReconcilerStrategy,
} from "../runtime-strategy"

/** No-op strategy for inventory-only or unmanaged system deployments */
export class NoopStrategy implements ReconcilerStrategy {
  readonly runtime = "noop"

  async reconcile(ctx: ReconcileContext): Promise<ReconcileResult> {
    // Inventory-only: mark as running, no drift detection
    return {
      status: ctx.component.kind === "task" ? "completed" : "running",
      actualImage: null,
      driftDetected: false,
    }
  }
}
