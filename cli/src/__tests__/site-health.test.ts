/**
 * Tests for site controller health monitor.
 *
 * Covers:
 *   - HealthMonitor: snapshot building, degradation detection
 *   - Start/stop lifecycle
 */
import { describe, expect, it, mock } from "bun:test"

import type { Executor, HealthStatus } from "../site/execution/executor.js"
import { HealthMonitor, type HealthSnapshot } from "../site/health.js"

async function waitForAssertion(
  fn: () => void,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 10_000
  const intervalMs = opts.intervalMs ?? 50
  const start = Date.now()
  let lastErr: unknown
  while (Date.now() - start < timeoutMs) {
    try {
      fn()
      return
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  }
  throw lastErr
}

function mockExecutor(
  healthResults: Record<string, HealthStatus>
): Pick<Executor, "healthCheckAll" | "type"> {
  return {
    type: "compose",
    healthCheckAll: mock().mockResolvedValue(healthResults),
  }
}

describe("HealthMonitor", () => {
  it("reports healthy when all components are healthy", async () => {
    const executor = mockExecutor({
      api: "healthy",
      web: "healthy",
      db: "healthy",
    })

    const monitor = new HealthMonitor(executor as any, { intervalMs: 60_000 })
    const stop = monitor.start()

    await waitForAssertion(() => {
      expect(monitor.getLastSnapshot()).not.toBeNull()
    })

    const snapshot = monitor.getLastSnapshot()!
    expect(snapshot.overallStatus).toBe("healthy")
    expect(snapshot.components.api).toBe("healthy")
    expect(snapshot.components.web).toBe("healthy")
    expect(snapshot.components.db).toBe("healthy")

    stop()
  })

  it("reports degraded when a component is starting", async () => {
    const executor = mockExecutor({
      api: "healthy",
      web: "starting",
    })

    const monitor = new HealthMonitor(executor as any, { intervalMs: 60_000 })
    const stop = monitor.start()

    await waitForAssertion(() => {
      expect(monitor.getLastSnapshot()).not.toBeNull()
    })

    expect(monitor.getLastSnapshot()!.overallStatus).toBe("degraded")
    stop()
  })

  it("reports unhealthy when a component is unhealthy", async () => {
    const executor = mockExecutor({
      api: "unhealthy",
      web: "healthy",
    })

    const monitor = new HealthMonitor(executor as any, { intervalMs: 60_000 })
    const stop = monitor.start()

    await waitForAssertion(() => {
      expect(monitor.getLastSnapshot()).not.toBeNull()
    })

    expect(monitor.getLastSnapshot()!.overallStatus).toBe("unhealthy")
    stop()
  })

  it("calls degradation callback on non-healthy state", async () => {
    const executor = mockExecutor({
      api: "unhealthy",
    })

    const onDegradation = mock()
    const monitor = new HealthMonitor(
      executor as any,
      { intervalMs: 60_000 },
      onDegradation
    )
    const stop = monitor.start()

    await waitForAssertion(() => {
      expect(onDegradation).toHaveBeenCalled()
    })

    const snapshot = onDegradation.mock.calls[0][0] as HealthSnapshot
    expect(snapshot.overallStatus).toBe("unhealthy")

    stop()
  })

  it("does not call degradation callback when healthy", async () => {
    const executor = mockExecutor({
      api: "healthy",
      web: "healthy",
    })

    const onDegradation = mock()
    const monitor = new HealthMonitor(
      executor as any,
      { intervalMs: 60_000 },
      onDegradation
    )
    const stop = monitor.start()

    await waitForAssertion(() => {
      expect(monitor.getLastSnapshot()).not.toBeNull()
    })

    expect(onDegradation).not.toHaveBeenCalled()
    stop()
  })

  it("tracks running state correctly", () => {
    const executor = mockExecutor({ api: "healthy" })
    const monitor = new HealthMonitor(executor as any, { intervalMs: 60_000 })

    expect(monitor.isRunning()).toBe(false)
    const stop = monitor.start()
    expect(monitor.isRunning()).toBe(true)
    stop()
    expect(monitor.isRunning()).toBe(false)
  })

  it("returns null snapshot before first tick", () => {
    const executor = mockExecutor({ api: "healthy" })
    const monitor = new HealthMonitor(executor as any, { intervalMs: 60_000 })

    expect(monitor.getLastSnapshot()).toBeNull()
  })
})
