import type {
  ReconcileContext,
  ReconcileResult,
  ReconcilerStrategy,
} from "../runtime-strategy"

/**
 * Windows realm strategies — backed by the site controller.
 *
 * The site controller on the target host manages Windows Services / IIS.
 * These server-side strategies read controller-reported state.
 */
export class WindowsServiceStrategy implements ReconcilerStrategy {
  readonly runtime = "windows_service"

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

export class IisStrategy implements ReconcilerStrategy {
  readonly runtime = "iis"

  async reconcile(ctx: ReconcileContext): Promise<ReconcileResult> {
    const controllerState = (ctx.workload as any).controllerReportedState as
      | { status: string; actualImage: string | null }
      | undefined

    if (!controllerState) {
      return {
        status: "running",
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
