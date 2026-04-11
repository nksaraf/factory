import type {
  ReconcileContext,
  ReconcileResult,
  ReconcilerStrategy,
} from "../runtime-strategy"

/**
 * systemd realm strategy — backed by the site controller.
 *
 * The site controller on the target host manages systemd units.
 * This server-side strategy reads controller-reported state.
 */
export class SystemdStrategy implements ReconcilerStrategy {
  readonly runtime = "systemd"

  async reconcile(ctx: ReconcileContext): Promise<ReconcileResult> {
    const controllerState = (ctx.workload as any).controllerReportedState as
      | { status: string; actualImage: string | null }
      | undefined

    if (!controllerState) {
      return {
        status: ctx.component.kind === "task" ? "completed" : "running",
        actualImage: null,
        driftDetected: false,
      }
    }

    return {
      status: controllerState.status as ReconcileResult["status"],
      actualImage: controllerState.actualImage,
      driftDetected: controllerState.actualImage !== ctx.workload.desiredImage,
    }
  }
}
