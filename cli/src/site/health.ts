/**
 * Health monitor — periodic health checking of all component deployments.
 *
 * Runs alongside the reconcile loop at a higher frequency,
 * surfacing degradation without waiting for a full reconcile cycle.
 */
import type { Executor, HealthStatus } from "./execution/executor.js"

export interface HealthSnapshot {
  timestamp: string
  components: Record<string, HealthStatus>
  overallStatus: "healthy" | "degraded" | "unhealthy"
}

export interface HealthMonitorConfig {
  intervalMs: number
}

export class HealthMonitor {
  private executor: Executor
  private config: HealthMonitorConfig
  private timer: ReturnType<typeof setInterval> | null = null
  private lastSnapshot: HealthSnapshot | null = null
  private onDegradation?: (snapshot: HealthSnapshot) => void

  constructor(
    executor: Executor,
    config: HealthMonitorConfig,
    onDegradation?: (snapshot: HealthSnapshot) => void
  ) {
    this.executor = executor
    this.config = config
    this.onDegradation = onDegradation
  }

  start(): () => void {
    const tick = async () => {
      try {
        const components = await this.executor.healthCheckAll()
        const snapshot = buildSnapshot(components)
        this.lastSnapshot = snapshot

        if (snapshot.overallStatus !== "healthy" && this.onDegradation) {
          this.onDegradation(snapshot)
        }
      } catch {
        // health check failure — continue polling
      }
    }

    tick()
    this.timer = setInterval(tick, this.config.intervalMs)
    return () => this.stop()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  getLastSnapshot(): HealthSnapshot | null {
    return this.lastSnapshot
  }

  isRunning(): boolean {
    return this.timer !== null
  }
}

function buildSnapshot(
  components: Record<string, HealthStatus>
): HealthSnapshot {
  let hasUnhealthy = false
  let hasDegraded = false

  for (const status of Object.values(components)) {
    if (status === "unhealthy") hasUnhealthy = true
    if (status === "starting") hasDegraded = true
  }

  let overallStatus: HealthSnapshot["overallStatus"] = "healthy"
  if (hasUnhealthy) overallStatus = "unhealthy"
  else if (hasDegraded) overallStatus = "degraded"

  return {
    timestamp: new Date().toISOString(),
    components,
    overallStatus,
  }
}
