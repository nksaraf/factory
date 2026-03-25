import type { RuntimeStrategy, ReconcileContext, ReconcileResult } from "../runtime-strategy";

/** systemd runtime strategy — deploys components as systemd units on Linux hosts/VMs */
export class SystemdStrategy implements RuntimeStrategy {
  readonly runtime = "systemd";

  async reconcile(ctx: ReconcileContext): Promise<ReconcileResult> {
    // TODO: SSH into target host/VM
    // TODO: Generate systemd unit file from component spec
    // TODO: `systemctl daemon-reload && systemctl enable --now <unit>`
    // TODO: Check `systemctl is-active <unit>` for status
    return {
      status: ctx.component.kind === "task" ? "completed" : "running",
      actualImage: null,
      driftDetected: false,
    };
  }
}
