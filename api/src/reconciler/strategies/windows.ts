import type { RuntimeStrategy, ReconcileContext, ReconcileResult } from "../runtime-strategy";

/**
 * Windows runtime strategy — deploys components as Windows Services or IIS sites.
 * Handles both 'windows_service' and 'iis' runtimes.
 */
export class WindowsServiceStrategy implements RuntimeStrategy {
  readonly runtime = "windows_service";

  async reconcile(ctx: ReconcileContext): Promise<ReconcileResult> {
    // TODO: SSH (or WinRM) into target Windows host/VM
    // TODO: For windows_service: `sc.exe create/start` or `New-Service` via PowerShell
    // TODO: Check service status via `Get-Service`
    return {
      status: ctx.component.kind === "task" ? "completed" : "running",
      actualImage: null,
      driftDetected: false,
    };
  }
}

export class IisStrategy implements RuntimeStrategy {
  readonly runtime = "iis";

  async reconcile(ctx: ReconcileContext): Promise<ReconcileResult> {
    // TODO: SSH into target Windows host/VM
    // TODO: Deploy to IIS via PowerShell (`New-WebApplication`, `Set-ItemProperty IIS:\Sites\...`)
    // TODO: Check IIS site status
    return {
      status: "running",
      actualImage: null,
      driftDetected: false,
    };
  }
}
