import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { StormDetector } from "./storm-detector"

describe("StormDetector", () => {
  let detector: StormDetector

  beforeEach(() => {
    detector = new StormDetector({ thresholdPerMinute: 5, windowMs: 60_000 })
  })

  afterEach(() => {
    detector.destroy()
  })

  it("does not detect storm below threshold", () => {
    for (let i = 0; i < 4; i++) {
      expect(detector.record("ops.workspace", "default")).toBe(false)
    }
  })

  it("detects storm when threshold exceeded", () => {
    for (let i = 0; i < 5; i++) {
      detector.record("ops.workspace", "default")
    }
    expect(detector.record("ops.workspace", "default")).toBe(true)
  })

  it("isolates storms by key", () => {
    for (let i = 0; i < 5; i++) {
      detector.record("ops.workspace", "default")
    }
    expect(detector.record("ops.workspace", "other-scope")).toBe(false)
    expect(detector.record("infra.host", "default")).toBe(false)
  })

  it("reports active storms", () => {
    for (let i = 0; i < 6; i++) {
      detector.record("ops.workspace", "default")
    }
    const storms = detector.activeStorms()
    expect(storms).toHaveLength(1)
    expect(storms[0]).toMatchObject({
      topicPrefix: "ops.workspace",
      scopeId: "default",
    })
  })

  it("clears storm state after window expires", () => {
    vi.useFakeTimers()
    for (let i = 0; i < 6; i++) {
      detector.record("ops.workspace", "default")
    }
    expect(detector.isStorming("ops.workspace", "default")).toBe(true)
    vi.advanceTimersByTime(61_000)
    detector.tick()
    expect(detector.isStorming("ops.workspace", "default")).toBe(false)
    vi.useRealTimers()
  })
})
