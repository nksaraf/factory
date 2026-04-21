import { Effect, Layer, Duration } from "effect"
import { makeHealthProbe } from "@smp/factory-shared/effect/health-probe"
import { ExecutorTag } from "../services/executor.js"
import {
  HealthMonitorTag,
  type HealthMonitorService,
  type HealthSnapshot,
} from "../services/health-monitor.js"

function deriveOverallStatus(
  components: Record<string, string>
): HealthSnapshot["overallStatus"] {
  const statuses = Object.values(components)
  if (statuses.length === 0) return "healthy"
  if (statuses.every((s) => s === "healthy" || s === "none")) return "healthy"
  if (statuses.some((s) => s === "unhealthy")) return "unhealthy"
  return "degraded"
}

export const HealthMonitorLive = Layer.effect(
  HealthMonitorTag,
  Effect.gen(function* () {
    const executor = yield* ExecutorTag

    const probe = yield* makeHealthProbe<HealthSnapshot>({
      check: executor.healthCheckAll.pipe(
        Effect.map((components) => ({
          components,
          overallStatus: deriveOverallStatus(components),
          checkedAt: new Date().toISOString(),
        })),
        Effect.orElseSucceed(() => ({
          components: {} as Record<
            string,
            import("../../site/execution/executor.js").HealthStatus
          >,
          overallStatus: "unhealthy" as const,
          checkedAt: new Date().toISOString(),
        }))
      ),
      interval: Duration.seconds(15),
    })

    return HealthMonitorTag.of({
      latest: probe.latest,
      changes: probe.changes,
      fiber: probe.fiber,
    }) satisfies HealthMonitorService
  })
)
