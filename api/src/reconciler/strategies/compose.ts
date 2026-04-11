import type {
  ReconcileContext,
  ReconcileResult,
  ReconcilerStrategy,
} from "../runtime-strategy"

/** Docker Compose realm strategy — deploys components as compose services on a host/VM */
export class ComposeStrategy implements ReconcilerStrategy {
  readonly runtime = "compose"

  async reconcile(ctx: ReconcileContext): Promise<ReconcileResult> {
    // TODO: SSH into target host/VM
    // TODO: Generate docker-compose.yml snippet for this component
    // TODO: Run `docker compose up -d <service>` via SSH
    // TODO: Check container status for drift detection
    return {
      status: ctx.component.kind === "task" ? "completed" : "running",
      actualImage: null,
      driftDetected: false,
    }
  }
}
