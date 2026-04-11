import { describe, it, expect } from "bun:test"
import {
  qualityConventionsSchema,
  qualityCheckSchema,
  qualityCoverageSchema,
  resolveComponentQuality,
  defaultConventionsConfig,
  parseConventionsInput,
} from "./conventions-schema"
import type { QualityConventions } from "./conventions-schema"

describe("qualityCheckSchema", () => {
  it("provides defaults", () => {
    const result = qualityCheckSchema.parse({})
    expect(result).toEqual({ enabled: true, block_pr: false })
  })

  it("accepts explicit values", () => {
    const result = qualityCheckSchema.parse({ enabled: false, block_pr: true })
    expect(result).toEqual({ enabled: false, block_pr: true })
  })
})

describe("qualityCoverageSchema", () => {
  it("provides defaults", () => {
    const result = qualityCoverageSchema.parse({})
    expect(result).toEqual({ enabled: false, min_line: 0, min_branch: 0 })
  })

  it("validates range", () => {
    expect(() => qualityCoverageSchema.parse({ min_line: 101 })).toThrow()
    expect(() => qualityCoverageSchema.parse({ min_line: -1 })).toThrow()
  })
})

describe("qualityConventionsSchema", () => {
  it("provides full defaults", () => {
    const result = qualityConventionsSchema.parse({})
    expect(result.lint).toEqual({ enabled: true, block_pr: true })
    expect(result.typecheck).toEqual({ enabled: true, block_pr: true })
    expect(result.test).toEqual({ enabled: true, block_pr: true })
    expect(result.format).toEqual({ enabled: true, block_pr: false })
    expect(result.overrides).toBeUndefined()
  })

  it("parses overrides", () => {
    const result = qualityConventionsSchema.parse({
      overrides: {
        "my-api": {
          lint: { block_pr: false },
        },
      },
    })
    expect(result.overrides?.["my-api"]?.lint?.block_pr).toBe(false)
  })
})

describe("resolveComponentQuality", () => {
  const base: QualityConventions = qualityConventionsSchema.parse({
    lint: { enabled: true, block_pr: true },
    typecheck: { enabled: true, block_pr: true },
    test: { enabled: true, block_pr: true },
    format: { enabled: true, block_pr: false },
    overrides: {
      "my-api": {
        lint: { block_pr: false },
        test: {
          coverage: { enabled: true, min_line: 80 },
        },
      },
      legacy: {
        lint: { enabled: false },
      },
      "critical-service": {
        format: { block_pr: true },
      },
    },
  })

  it("returns base when no override exists", () => {
    const result = resolveComponentQuality(base, "unknown-component")
    expect(result.lint.block_pr).toBe(true)
  })

  it("enforces floor: cannot disable block_pr when base has it enabled", () => {
    const result = resolveComponentQuality(base, "my-api")
    // lint has block_pr: true at base, override tries false -> stays true
    expect(result.lint.block_pr).toBe(true)
  })

  it("allows disabling block_pr when base has it disabled", () => {
    const result = resolveComponentQuality(base, "my-api")
    // format has block_pr: false at base, no override -> stays false
    expect(result.format.block_pr).toBe(false)
  })

  it("merges coverage overrides", () => {
    const result = resolveComponentQuality(base, "my-api")
    expect(result.test.coverage?.enabled).toBe(true)
    expect(result.test.coverage?.min_line).toBe(80)
    expect(result.test.coverage?.min_branch).toBe(0) // default preserved
  })

  it("allows disabling a check via override", () => {
    const result = resolveComponentQuality(base, "legacy")
    expect(result.lint.enabled).toBe(false)
  })

  it("allows override to raise block_pr from false to true", () => {
    const result = resolveComponentQuality(base, "critical-service")
    // format has block_pr: false at base, override raises to true
    expect(result.format.block_pr).toBe(true)
  })
})

describe("defaultConventionsConfig includes quality", () => {
  it("has quality section with defaults", () => {
    const config = defaultConventionsConfig()
    expect(config.quality).toBeDefined()
    expect(config.quality.lint.enabled).toBe(true)
    expect(config.quality.lint.block_pr).toBe(true)
  })
})

describe("parseConventionsInput with quality", () => {
  it("parses quality from YAML-like input", () => {
    const config = parseConventionsInput({
      quality: {
        lint: { enabled: true, "block-pr": true },
        format: { enabled: true, "block-pr": false },
      },
    })
    expect(config.quality.lint.block_pr).toBe(true)
    expect(config.quality.format.block_pr).toBe(false)
  })

  it("handles missing quality section gracefully", () => {
    const config = parseConventionsInput({})
    expect(config.quality).toBeDefined()
    expect(config.quality.lint.enabled).toBe(true)
  })
})
