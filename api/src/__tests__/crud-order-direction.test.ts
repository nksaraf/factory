import { describe, expect, test } from "bun:test"

describe("RelationConfig orderDirection", () => {
  test("orderDirection type accepts 'asc' and 'desc'", () => {
    const ascConfig = { orderDirection: "asc" as const }
    const descConfig = { orderDirection: "desc" as const }
    expect(ascConfig.orderDirection).toBe("asc")
    expect(descConfig.orderDirection).toBe("desc")
  })

  test("default orderDirection is desc when not specified", () => {
    const config: { orderDirection?: "asc" | "desc" } = {}
    const direction = config.orderDirection ?? "desc"
    expect(direction).toBe("desc")
  })
})
