import { describe, it, expect } from "vitest"
import { expandBoundsForFocus, type Bounds } from "./expand-bounds"

describe("expandBoundsForFocus", () => {
  it("expands narrow vertical bounds to minimum width", () => {
    // A very narrow vertical road (same lng, different lat)
    const bounds: Bounds = [[77.5, 12.9], [77.5, 13.0]]
    const result = expandBoundsForFocus(bounds)

    const [min, max] = result
    const width = max[0] - min[0]
    const height = max[1] - min[1]

    // Width should be at least MIN_DEGREES_LNG (0.002)
    expect(width).toBeGreaterThanOrEqual(0.002)
    // Height should be expanded with margin
    expect(height).toBeGreaterThan(0.1)
  })

  it("adds margin so geometry doesn't touch edges", () => {
    const bounds: Bounds = [[77.5, 12.9], [77.6, 13.0]]
    const result = expandBoundsForFocus(bounds)

    // Result should be larger than input
    expect(result[0][0]).toBeLessThan(77.5)
    expect(result[0][1]).toBeLessThan(12.9)
    expect(result[1][0]).toBeGreaterThan(77.6)
    expect(result[1][1]).toBeGreaterThan(13.0)
  })

  it("preserves center point", () => {
    const bounds: Bounds = [[77.5, 12.9], [77.6, 13.0]]
    const result = expandBoundsForFocus(bounds)

    const inputCenterLng = (77.5 + 77.6) / 2
    const inputCenterLat = (12.9 + 13.0) / 2
    const resultCenterLng = (result[0][0] + result[1][0]) / 2
    const resultCenterLat = (result[0][1] + result[1][1]) / 2

    expect(resultCenterLng).toBeCloseTo(inputCenterLng, 10)
    expect(resultCenterLat).toBeCloseTo(inputCenterLat, 10)
  })

  it("handles point-like bounds (zero width and height)", () => {
    const bounds: Bounds = [[77.5, 12.9], [77.5, 12.9]]
    const result = expandBoundsForFocus(bounds)

    const width = result[1][0] - result[0][0]
    const height = result[1][1] - result[0][1]

    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
  })
})
