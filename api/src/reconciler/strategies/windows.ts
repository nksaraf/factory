import type {
  RealmStrategy,
  ReconcileContext,
  ReconcileResult,
} from "../runtime-strategy"

/**
 * Windows realm strategy — deploys components as Windows Services or IIS sites.
 * Handles both 'windows_service' and 'iis' runtimes.
 */
export class WindowsServiceStrategy implements RealmStrategy {
  readonly runtime = "windows_service"

  async reconcile(ctx: ReconcileContext): Promise<ReconcileResult> {
    // TODO: SSH (or WinRM) into target Windows host/VM
    // TODO: For windows_service: `sc.exe create/start` or `New-Service` via PowerShell
    // TODO: Check service status via `Get-Service`
    return {
      status: ctx.component.kind === "task" ? "completed" : "running",
      actualImage: null,
      driftDetected: false,
    }
  }
}

export class IisStrategy implements RealmStrategy {
  readonly runtime = "iis"

  async reconcile(ctx: ReconcileContext): Promise<ReconcileResult> {
    // TODO: SSH into target Windows host/VM
    // TODO: Deploy to IIS via PowerShell (`New-WebApplication`, `Set-ItemProperty IIS:\Sites\...`)
    // TODO: Check IIS site status
    return {
      status: "running",
      actualImage: null,
      driftDetected: false,
    }
  }
}
