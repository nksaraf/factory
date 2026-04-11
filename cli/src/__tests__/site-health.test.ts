/**
 * Tests for site controller health monitor.
 *
 * Covers:
 *   - HealthMonitor: snapshot building, degradation detection
 *   - Start/stop lifecycle
 */
import { afterEach, describe, expect, it, vi } from "vitest"

import type { Executor, HealthStatus } from "../site/execution/executor.js"
import { HealthMonitor, type HealthSnapshot } from "../site/health.js"

// ---------------------------------------------------------------------------
// Mock executor
// ---------------------------------------------------------------------------

function mockExecutor(
  healthResults: Record<string, HealthStatus>
): Pick<Executor, "healthCheckAll" | "type"> {
  return {
    type: "compose",
    healthCheckAll: vi.fn().mockResolvedValue(healthResults),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HealthMonitor", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("reports healthy when all components are healthy", async () => {
    const executor = mockExecutor({
      api: "healthy",
      web: "healthy",
      db: "healthy",
    })

    const monitor = new HealthMonitor(executor as any, { intervalMs: 60_000 })
    const stop = monitor.start()

    await vi.waitFor(() => {
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

    await vi.waitFor(() => {
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

    await vi.waitFor(() => {
      expect(monitor.getLastSnapshot()).not.toBeNull()
    })

    expect(monitor.getLastSnapshot()!.overallStatus).toBe("unhealthy")
    stop()
  })

  it("calls degradation callback on non-healthy state", async () => {
    const executor = mockExecutor({
      api: "unhealthy",
    })

    const onDegradation = vi.fn()
    const monitor = new HealthMonitor(
      executor as any,
      { intervalMs: 60_000 },
      onDegradation
    )
    const stop = monitor.start()

    await vi.waitFor(() => {
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

    const onDegradation = vi.fn()
    const monitor = new HealthMonitor(
      executor as any,
      { intervalMs: 60_000 },
      onDegradation
    )
    const stop = monitor.start()

    await vi.waitFor(() => {
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
