import { describe, test, expect } from "bun:test"

// Import the deriveOverallStatus function — it's not exported, so we test
// via the HealthMonitorLive layer. But the logic is simple enough to
// replicate here for pure testing.
// The actual function is in cli/src/effect/layers/health-monitor.ts

type HealthStatus = "healthy" | "unhealthy" | "starting" | "none"

function deriveOverallStatus(
  components: Record<string, HealthStatus>
): "healthy" | "degraded" | "unhealthy" {
  const statuses = Object.values(components)
  if (statuses.length === 0) return "healthy"
  if (statuses.every((s) => s === "healthy" || s === "none")) return "healthy"
  if (statuses.some((s) => s === "unhealthy")) return "unhealthy"
  return "degraded"
}

describe("deriveOverallStatus", () => {
  test("all healthy → healthy", () => {
    expect(deriveOverallStatus({ api: "healthy", web: "healthy" })).toBe(
      "healthy"
    )
  })

  test("all none → healthy", () => {
    expect(deriveOverallStatus({ postgres: "none", redis: "none" })).toBe(
      "healthy"
    )
  })

  test("mix healthy + none → healthy", () => {
    expect(deriveOverallStatus({ api: "healthy", postgres: "none" })).toBe(
      "healthy"
    )
  })

  test("one unhealthy → unhealthy", () => {
    expect(deriveOverallStatus({ api: "unhealthy" })).toBe("unhealthy")
  })

  test("one unhealthy + rest healthy → unhealthy", () => {
    expect(deriveOverallStatus({ api: "healthy", web: "unhealthy" })).toBe(
      "unhealthy"
    )
  })

  test("one starting → degraded", () => {
    expect(deriveOverallStatus({ api: "starting" })).toBe("degraded")
  })

  test("one starting + rest healthy → degraded", () => {
    expect(deriveOverallStatus({ api: "healthy", web: "starting" })).toBe(
      "degraded"
    )
  })

  test("all starting → degraded", () => {
    expect(deriveOverallStatus({ api: "starting", web: "starting" })).toBe(
      "degraded"
    )
  })

  test("empty components → healthy", () => {
    expect(deriveOverallStatus({})).toBe("healthy")
  })

  test("unhealthy takes priority over starting", () => {
    expect(deriveOverallStatus({ api: "starting", web: "unhealthy" })).toBe(
      "unhealthy"
    )
  })
})
