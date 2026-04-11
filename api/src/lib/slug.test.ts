import { describe, expect, it } from "vitest"

import {
  SLUG_PATTERN,
  allocateSlug,
  generateMemorableSlug,
  slugifyFromLabel,
  validateExplicitSlug,
  InvalidSlugError,
} from "./slug"

describe("slugifyFromLabel", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyFromLabel("Hello World")).toBe("hello-world")
    expect(slugifyFromLabel("Foo_Bar  Baz")).toBe("foo-bar-baz")
  })

  it("strips combining marks", () => {
    expect(slugifyFromLabel("Café")).toBe("cafe")
  })

  it("returns empty for punctuation-only", () => {
    expect(slugifyFromLabel("!!!")).toBe("")
    expect(slugifyFromLabel("   ")).toBe("")
  })
})

describe("validateExplicitSlug", () => {
  it("accepts valid slugs", () => {
    expect(validateExplicitSlug("a-b-1")).toBe("a-b-1")
  })

  it("rejects invalid", () => {
    expect(() => validateExplicitSlug("Bad_Slug")).toThrow(InvalidSlugError)
    expect(() => validateExplicitSlug("-bad")).toThrow(InvalidSlugError)
  })
})

describe("generateMemorableSlug", () => {
  it("matches pattern and is unique across calls", () => {
    const a = generateMemorableSlug()
    const b = generateMemorableSlug()
    expect(SLUG_PATTERN.test(a)).toBe(true)
    expect(SLUG_PATTERN.test(b)).toBe(true)
    expect(a).not.toBe(b)
  })
})

describe("allocateSlug", () => {
  it("uses explicit slug when free", async () => {
    const s = await allocateSlug({
      baseLabel: "ignored",
      explicitSlug: "my-custom",
      isTaken: async () => false,
    })
    expect(s).toBe("my-custom")
  })

  it("throws when explicit slug is taken", async () => {
    await expect(
      allocateSlug({
        baseLabel: "x",
        explicitSlug: "taken",
        isTaken: async () => true,
      })
    ).rejects.toThrow(InvalidSlugError)
  })

  it("appends numeric suffix on collision", async () => {
    const taken = new Set(["app", "app-2"])
    const s = await allocateSlug({
      baseLabel: "App",
      isTaken: async (slug) => taken.has(slug),
    })
    expect(s).toBe("app-3")
  })

  it("uses memorable slug when label is empty", async () => {
    const s = await allocateSlug({
      baseLabel: "@@@",
      isTaken: async () => false,
    })
    expect(SLUG_PATTERN.test(s)).toBe(true)
    expect(s.length).toBeGreaterThan(5)
  })
})
