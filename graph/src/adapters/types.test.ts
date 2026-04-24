import { describe, expect, it } from "bun:test"
import type { AdapterCapabilities } from "./types"

describe("Adapter types", () => {
  it("describes the adapter contract", () => {
    const caps: AdapterCapabilities = {
      supportsWatch: false,
      supportsAggregate: false,
    }
    expect(caps.supportsWatch).toBe(false)
    expect(caps.supportsAggregate).toBe(false)
  })
})
