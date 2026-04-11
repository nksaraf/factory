import type {
  ReconcileContext,
  ReconcileResult,
  ReconcilerStrategy,
} from "../runtime-strategy"

/**
 * Docker Compose realm strategy — backed by the site controller.
 *
 * The site controller running on the target host owns the actual
 * docker compose lifecycle. This server-side strategy reads the
 * controller-reported state to detect drift and report status.
 */
export class ComposeStrategy implements ReconcilerStrategy {
  readonly runtime = "compose"

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
