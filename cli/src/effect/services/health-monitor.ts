import { Context, Effect, PubSub } from "effect"
import type { HealthStatus } from "../../site/execution/executor.js"

export interface HealthSnapshot {
  readonly components: Record<string, HealthStatus>
  readonly overallStatus: "healthy" | "degraded" | "unhealthy"
  readonly checkedAt: string
}

export interface HealthMonitorService {
  readonly latest: Effect.Effect<HealthSnapshot | null>
  readonly changes: PubSub.PubSub<HealthSnapshot>
  readonly fiber: Effect.Effect<never>
}

export class HealthMonitorTag extends Context.Tag("HealthMonitor")<
  HealthMonitorTag,
  HealthMonitorService
>() {}
