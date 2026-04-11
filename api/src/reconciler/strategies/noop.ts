import type {
  RealmStrategy,
  ReconcileContext,
  ReconcileResult,
} from "../runtime-strategy"

/** No-op strategy for inventory-only or unmanaged deployment targets */
export class NoopStrategy implements RealmStrategy {
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
