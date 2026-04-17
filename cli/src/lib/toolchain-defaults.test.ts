import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  defaultsForTier,
  ensureToolchainDefaults,
} from "./toolchain-defaults.js"

let rootDir: string

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "toolchain-"))
})

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true })
})

function writePkg(obj: Record<string, unknown>): void {
  writeFileSync(join(rootDir, "package.json"), JSON.stringify(obj, null, 2))
}

function readPkg(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"))
}

describe("defaultsForTier", () => {
  test("marketing gets baseline (no turbo)", () => {
    const d = defaultsForTier("marketing")
    expect(d).toHaveProperty("@typescript/native-preview")
    expect(d).toHaveProperty("oxlint")
    expect(d).toHaveProperty("oxfmt")
    expect(d).not.toHaveProperty("turbo")
  })

  test("system gets baseline + turbo", () => {
    const d = defaultsForTier("system")
    expect(d).toHaveProperty("@typescript/native-preview")
    expect(d).toHaveProperty("turbo")
  })

  test("product gets baseline + turbo", () => {
    const d = defaultsForTier("product")
    expect(d).toHaveProperty("turbo")
  })

  test("undefined tier returns baseline", () => {
    const d = defaultsForTier(undefined)
    expect(d).toHaveProperty("oxlint")
    expect(d).not.toHaveProperty("turbo")
  })
})

describe("ensureToolchainDefaults", () => {
  test("no package.json → no-op", () => {
    const res = ensureToolchainDefaults(rootDir)
    expect(res).toEqual({ changed: false, added: [] })
  })

  test("package.json without dx.tier → no-op (conservative default)", () => {
    writePkg({ name: "foo", devDependencies: {} })
    const res = ensureToolchainDefaults(rootDir)
    expect(res).toEqual({ changed: false, added: [] })
    // devDependencies untouched.
    expect(readPkg().devDependencies).toEqual({})
  })

  test("marketing repo missing all defaults → adds all three", () => {
    writePkg({ name: "foo", dx: { tier: "marketing" } })
    const res = ensureToolchainDefaults(rootDir)
    expect(res.changed).toBe(true)
    expect(res.added).toContain("@typescript/native-preview")
    expect(res.added).toContain("oxlint")
    expect(res.added).toContain("oxfmt")
    expect(res.added).not.toContain("turbo") // marketing doesn't get turbo

    const pkg = readPkg()
    const devDeps = pkg.devDependencies as Record<string, string>
    expect(devDeps["@typescript/native-preview"]).toBeTruthy()
    expect(devDeps.oxlint).toBeTruthy()
    expect(devDeps.oxfmt).toBeTruthy()
  })

  test("system repo gets turbo too", () => {
    writePkg({ name: "foo", dx: { tier: "system" } })
    const res = ensureToolchainDefaults(rootDir)
    expect(res.added).toContain("turbo")
  })

  test("existing entries are not overwritten (consumer override wins)", () => {
    writePkg({
      name: "foo",
      dx: { tier: "marketing" },
      devDependencies: { oxlint: "^99.0.0" }, // user pinned a weird version
    })
    const res = ensureToolchainDefaults(rootDir)
    expect(res.added).not.toContain("oxlint")
    expect((readPkg().devDependencies as any).oxlint).toBe("^99.0.0")
  })

  test("packages already in runtime dependencies are skipped", () => {
    writePkg({
      name: "foo",
      dx: { tier: "marketing" },
      dependencies: { oxfmt: "^0.1.0" }, // weird but valid
    })
    const res = ensureToolchainDefaults(rootDir)
    expect(res.added).not.toContain("oxfmt")
  })

  test("second run is idempotent (no changes)", () => {
    writePkg({ name: "foo", dx: { tier: "marketing" } })
    ensureToolchainDefaults(rootDir)
    const res = ensureToolchainDefaults(rootDir)
    expect(res.changed).toBe(false)
    expect(res.added).toEqual([])
  })

  test("sorts devDependencies alphabetically on write", () => {
    writePkg({
      name: "foo",
      dx: { tier: "marketing" },
      devDependencies: { zebra: "1.0.0", alpha: "1.0.0" },
    })
    ensureToolchainDefaults(rootDir)
    const pkg = readPkg()
    const keys = Object.keys(pkg.devDependencies as Record<string, string>)
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)))
  })

  test("malformed package.json → no-op (doesn't throw)", () => {
    writeFileSync(join(rootDir, "package.json"), "{ not json")
    const res = ensureToolchainDefaults(rootDir)
    expect(res).toEqual({ changed: false, added: [] })
  })

  test("invalid tier → treated as untyped → no-op", () => {
    writePkg({ name: "foo", dx: { tier: "something-weird" } })
    const res = ensureToolchainDefaults(rootDir)
    expect(res.changed).toBe(false)
  })
})
