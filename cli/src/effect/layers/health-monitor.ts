import { Effect, Layer, Duration } from "effect"
import { makeHealthProbe } from "@smp/factory-shared/effect/health-probe"
import { Executor } from "../services/executor.js"
import type { HealthStatus } from "../../site/execution/executor.js"
import {
  HealthMonitor,
  type IHealthMonitor,
  type HealthSnapshot,
} from "../services/health-monitor.js"

function deriveOverallStatus(
  components: Record<string, HealthStatus>
): HealthSnapshot["overallStatus"] {
  const statuses = Object.values(components)
  if (statuses.length === 0) return "healthy"
  if (statuses.every((s) => s === "healthy" || s === "none")) return "healthy"
  if (statuses.some((s) => s === "unhealthy")) return "unhealthy"
  return "degraded"
}

export const HealthMonitorLive = Layer.effect(
  HealthMonitor,
  Effect.gen(function* () {
    const executor = yield* Executor

    const probe = yield* makeHealthProbe<HealthSnapshot>({
      check: executor.healthCheckAll.pipe(
        Effect.map((components) => ({
          components,
          overallStatus: deriveOverallStatus(components),
          checkedAt: new Date().toISOString(),
        })),
        Effect.orElseSucceed(() => ({
          components: {} as Record<string, HealthStatus>,
          overallStatus: "unhealthy" as const,
          checkedAt: new Date().toISOString(),
        }))
      ),
      interval: Duration.seconds(15),
    })

    return HealthMonitor.of({
      latest: probe.latest,
      changes: probe.changes,
      fiber: probe.fiber,
    }) satisfies IHealthMonitor
  })
)
