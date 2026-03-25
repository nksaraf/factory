import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { formatTime, formatTimeWithDate, formatTimeWithSmartDate } from "./format-time"

describe("formatTime", () => {
  it("returns 'N/A' for null/undefined", () => {
    expect(formatTime(null)).toBe("N/A")
    expect(formatTime(undefined)).toBe("N/A")
  })

  it("returns 'N/A' for invalid date strings", () => {
    expect(formatTime("not-a-date")).toBe("N/A")
  })

  it("formats time in 12-hour format", () => {
    // Use a fixed date to avoid timezone issues
    const result = formatTimeWithDate("2026-01-15T14:30:00.000Z")
    // Should contain PM since 14:30 UTC is afternoon
    expect(result).toContain("PM")
    expect(result).toContain("Jan")
    expect(result).toContain("15")
  })
})

describe("formatTimeWithDate", () => {
  it("returns 'N/A' for null/undefined", () => {
    expect(formatTimeWithDate(null)).toBe("N/A")
    expect(formatTimeWithDate(undefined)).toBe("N/A")
  })

  it("always includes date part", () => {
    const result = formatTimeWithDate("2026-06-15T10:30:00.000Z")
    expect(result).toContain("Jun")
    expect(result).toContain("15")
  })
})

describe("formatTimeWithSmartDate", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-27T12:00:00.000Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns 'N/A' for null/undefined", () => {
    expect(formatTimeWithSmartDate(null)).toBe("N/A")
    expect(formatTimeWithSmartDate(undefined)).toBe("N/A")
  })

  it("shows 'Today' for today's dates", () => {
    const result = formatTimeWithSmartDate("2026-01-27T10:30:00.000Z")
    expect(result).toContain("Today")
  })

  it("shows 'Yesterday' for yesterday's dates", () => {
    const result = formatTimeWithSmartDate("2026-01-26T10:30:00.000Z")
    expect(result).toContain("Yesterday")
  })

  it("shows month and day for older dates", () => {
    const result = formatTimeWithSmartDate("2026-01-15T10:30:00.000Z")
    expect(result).toContain("Jan")
    expect(result).toContain("15")
    expect(result).not.toContain("Today")
    expect(result).not.toContain("Yesterday")
  })
})
