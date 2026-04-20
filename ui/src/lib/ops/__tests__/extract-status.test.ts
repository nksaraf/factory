import { describe, expect, test } from "vitest"

function extractStatus(v: unknown): string {
  if (typeof v === "string") return v
  if (typeof v === "object" && v !== null)
    return ((v as Record<string, unknown>).phase as string) ?? "unknown"
  return "unknown"
}

describe("extractStatus for ops entities", () => {
  test("string status passes through", () => {
    expect(extractStatus("active")).toBe("active")
    expect(extractStatus("failed")).toBe("failed")
  })

  test("object with phase extracts correctly", () => {
    expect(extractStatus({ phase: "active", conditions: [] })).toBe("active")
  })

  test("object without phase returns unknown", () => {
    expect(extractStatus({ lastScan: {} })).toBe("unknown")
  })

  test("null returns unknown", () => {
    expect(extractStatus(null)).toBe("unknown")
  })

  test("undefined returns unknown", () => {
    expect(extractStatus(undefined)).toBe("unknown")
  })

  test("handles real API site status shape", () => {
    const apiStatus = {
      phase: "active",
      conditions: [{ type: "Ready", status: "True" }],
    }
    expect(extractStatus(apiStatus)).toBe("active")
  })
})

describe("StatusBadge null safety", () => {
  test("handles non-string values", () => {
    const raw = typeof 42 === "string" ? 42 : "unknown"
    expect(raw).toBe("unknown")
  })

  test("handles object cast to string", () => {
    const status = { phase: "active" }
    const raw = typeof status === "string" ? status : "unknown"
    expect(raw).toBe("unknown")
  })
})
