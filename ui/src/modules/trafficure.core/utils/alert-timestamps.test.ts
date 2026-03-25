import { describe, it, expect } from "vitest"
import {
  normalizeApiTimestamp,
  mapApiTimestampsToAlertTimestamps,
  getAlertStartTime,
  getAlertEndTime,
  isAlertActive,
  getAlertDurationMs,
  getAlertDurationMinutes,
} from "./alert-timestamps"
import type { Alert } from "../types/alert"

// Minimal alert factory for testing
function makeAlert(overrides: Partial<Alert>): Alert {
  return {
    alertId: 1,
    id: "1",
    roadId: "road-1",
    roadName: "City/Main Street",
    alertType: "CONGESTION",
    severity: "WARNING",
    reason: "Speed drop",
    startedAt: "2026-01-27T10:00:00.000Z",
    timestamp: "2026-01-27T10:00:00.000Z",
    currentTravelTimeSec: 120,
    typicalTimeSec: 60,
    persistenceCount: 5,
    liveSpeedKmph: 20,
    velocityDecay: 0.5,
    saturationIndex: 0.8,
    deviationIndex: 1.2,
    impactCostSec: 300,
    geometry: { coordinates: [[77.5, 12.9], [77.6, 12.95]], type: "LineString" },
    coordinates: [77.5, 12.9],
    location: "Main Street",
    ...overrides,
  }
}

describe("normalizeApiTimestamp", () => {
  it("trims microseconds to milliseconds (6 → 3 fractional digits)", () => {
    expect(normalizeApiTimestamp("2026-01-27T19:40:46.359652+05:30"))
      .toBe("2026-01-27T19:40:46.359+05:30")
  })

  it("leaves millisecond-precision timestamps unchanged", () => {
    expect(normalizeApiTimestamp("2026-01-27T19:40:46.359+05:30"))
      .toBe("2026-01-27T19:40:46.359+05:30")
  })

  it("handles Z timezone suffix", () => {
    expect(normalizeApiTimestamp("2026-01-27T14:10:46.123456Z"))
      .toBe("2026-01-27T14:10:46.123Z")
  })

  it("returns undefined for non-string input", () => {
    expect(normalizeApiTimestamp(null)).toBeUndefined()
    expect(normalizeApiTimestamp(undefined)).toBeUndefined()
    expect(normalizeApiTimestamp(123)).toBeUndefined()
  })

  it("returns undefined for empty string", () => {
    expect(normalizeApiTimestamp("")).toBeUndefined()
  })
})

describe("mapApiTimestampsToAlertTimestamps", () => {
  it("maps alert_event_time to startTime for active alerts", () => {
    const result = mapApiTimestampsToAlertTimestamps({
      alert_event_time: "2026-01-27T10:00:00.000Z",
      timestamp: "2026-01-27T10:05:00.000Z",
      current_status: "ACTIVE",
    })
    expect(result.startTime).toBe("2026-01-27T10:00:00.000Z")
    expect(result.lastUpdatedAt).toBe("2026-01-27T10:05:00.000Z")
    expect(result.endTime).toBeUndefined()
  })

  it("maps timestamp to endTime for resolved alerts", () => {
    const result = mapApiTimestampsToAlertTimestamps({
      alert_event_time: "2026-01-27T10:00:00.000Z",
      timestamp: "2026-01-27T11:00:00.000Z",
      current_status: "RESOLVED",
    })
    expect(result.startTime).toBe("2026-01-27T10:00:00.000Z")
    expect(result.endTime).toBe("2026-01-27T11:00:00.000Z")
  })

  it("prefers alert_event_time over alertEventTime", () => {
    const result = mapApiTimestampsToAlertTimestamps({
      alert_event_time: "2026-01-27T10:00:00.000Z",
      alertEventTime: "2026-01-27T09:00:00.000Z",
      timestamp: "2026-01-27T10:05:00.000Z",
      current_status: "ACTIVE",
    })
    expect(result.startTime).toBe("2026-01-27T10:00:00.000Z")
  })

  it("falls back to alertEventTime when alert_event_time is missing", () => {
    const result = mapApiTimestampsToAlertTimestamps({
      alertEventTime: "2026-01-27T09:00:00.000Z",
      timestamp: "2026-01-27T10:05:00.000Z",
      current_status: "ACTIVE",
    })
    expect(result.startTime).toBe("2026-01-27T09:00:00.000Z")
  })

  it("normalizes microsecond timestamps", () => {
    const result = mapApiTimestampsToAlertTimestamps({
      alert_event_time: "2026-01-27T10:00:00.123456+05:30",
      timestamp: "2026-01-27T10:05:00.654321+05:30",
      current_status: "ACTIVE",
    })
    expect(result.startTime).toBe("2026-01-27T10:00:00.123+05:30")
    expect(result.lastUpdatedAt).toBe("2026-01-27T10:05:00.654+05:30")
  })
})

describe("getAlertStartTime", () => {
  it("returns startedAt as Date", () => {
    const alert = makeAlert({ startedAt: "2026-01-27T10:00:00.000Z" })
    const result = getAlertStartTime(alert)
    expect(result).toBeInstanceOf(Date)
    expect(result.toISOString()).toBe("2026-01-27T10:00:00.000Z")
  })
})

describe("getAlertEndTime", () => {
  it("returns null for active alerts", () => {
    const alert = makeAlert({ type: "active" })
    expect(getAlertEndTime(alert)).toBeNull()
  })

  it("returns resolvedAt for resolved alerts", () => {
    const alert = makeAlert({
      type: "resolved",
      resolvedAt: "2026-01-27T11:00:00.000Z",
    })
    const result = getAlertEndTime(alert)
    expect(result).toBeInstanceOf(Date)
    expect(result!.toISOString()).toBe("2026-01-27T11:00:00.000Z")
  })

  it("returns null for resolved alerts without resolvedAt", () => {
    const alert = makeAlert({ type: "resolved", resolvedAt: undefined })
    expect(getAlertEndTime(alert)).toBeNull()
  })
})

describe("isAlertActive", () => {
  it("returns true for active alerts", () => {
    expect(isAlertActive(makeAlert({ type: "active" }))).toBe(true)
  })

  it("returns false for resolved alerts", () => {
    expect(isAlertActive(makeAlert({ type: "resolved" }))).toBe(false)
  })

  it("returns false for suppressed alerts", () => {
    expect(isAlertActive(makeAlert({ type: "suppressed" }))).toBe(false)
  })

  it("returns true when type is undefined and no resolvedAt", () => {
    expect(isAlertActive(makeAlert({ type: undefined }))).toBe(true)
  })
})

describe("getAlertDurationMs / getAlertDurationMinutes", () => {
  it("returns null for active alerts", () => {
    const alert = makeAlert({ type: "active" })
    expect(getAlertDurationMs(alert)).toBeNull()
    expect(getAlertDurationMinutes(alert)).toBeNull()
  })

  it("calculates duration for resolved alerts", () => {
    const alert = makeAlert({
      type: "resolved",
      startedAt: "2026-01-27T10:00:00.000Z",
      resolvedAt: "2026-01-27T11:30:00.000Z",
    })
    expect(getAlertDurationMs(alert)).toBe(90 * 60 * 1000)
    expect(getAlertDurationMinutes(alert)).toBe(90)
  })
})
