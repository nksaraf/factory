import { describe, it, expect } from "vitest"
import {
  formatNumber,
  formatInteger,
  formatDecimal,
  formatDelay,
  formatDelayWithPrefix,
} from "./format-number"

describe("formatNumber", () => {
  it("formats with 1 decimal place by default", () => {
    expect(formatNumber(42.567)).toBe("42.6")
  })

  it("returns '0' for null/undefined/NaN", () => {
    expect(formatNumber(null)).toBe("0")
    expect(formatNumber(undefined)).toBe("0")
    expect(formatNumber(NaN)).toBe("0")
  })

  it("respects custom fraction digits", () => {
    expect(formatNumber(3.14159, { minimumFractionDigits: 2, maximumFractionDigits: 4 }))
      .toBe("3.1416")
  })
})

describe("formatInteger", () => {
  it("formats without decimals", () => {
    expect(formatInteger(42.7)).toBe("43")
  })

  it("handles null", () => {
    expect(formatInteger(null)).toBe("0")
  })
})

describe("formatDecimal", () => {
  it("formats with 1 decimal", () => {
    expect(formatDecimal(42.567)).toBe("42.6")
  })
})

describe("formatDelay", () => {
  it("shows seconds for values under 60", () => {
    expect(formatDelay(30)).toBe("30s")
    expect(formatDelay(0)).toBe("0s")
  })

  it("shows minutes for values >= 60", () => {
    expect(formatDelay(120)).toBe("2m")
    expect(formatDelay(90)).toBe("2m") // 1.5 → rounded to 2
  })

  it("handles null/undefined/NaN", () => {
    expect(formatDelay(null)).toBe("0s")
    expect(formatDelay(undefined)).toBe("0s")
    expect(formatDelay(NaN)).toBe("0s")
  })
})

describe("formatDelayWithPrefix", () => {
  it("adds + prefix for non-zero values", () => {
    expect(formatDelayWithPrefix(30)).toBe("+30s")
    expect(formatDelayWithPrefix(120)).toBe("+2m")
  })

  it("does not add + for zero", () => {
    expect(formatDelayWithPrefix(0)).toBe("0s")
  })
})
