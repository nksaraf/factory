import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  detectPackageManager,
  findProjectRoot,
  ProjectContext,
} from "./project.js"

let rootDir: string

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "project-test-"))
})

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true })
})

// Helpers
function writeJson(path: string, obj: unknown): void {
  writeFileSync(path, JSON.stringify(obj, null, 2))
}
function composeAt(dir: string): void {
  writeFileSync(
    join(dir, "docker-compose.yaml"),
    "services:\n  dummy:\n    image: nginx\n    labels:\n      x-dx.name: dummy\n"
  )
}

describe("findProjectRoot — closest-wins precedence", () => {
  test("package.json#dx inside a compose monorepo wins over outer compose", () => {
    // outer has compose; inner apps/marketing has package.json#dx
    composeAt(rootDir)
    const inner = join(rootDir, "apps", "marketing")
    mkdirSync(inner, { recursive: true })
    writeJson(join(inner, "package.json"), {
      name: "@lepton/marketing-foo",
      dx: { tier: "marketing" },
    })

    const r = findProjectRoot(inner)
    expect(r).toEqual({ rootDir: inner, mode: "package" })
  })

  test("compose wins over package.json#dx when both in the same dir", () => {
    composeAt(rootDir)
    writeJson(join(rootDir, "package.json"), {
      name: "foo",
      dx: { tier: "product" },
    })
    const r = findProjectRoot(rootDir)
    expect(r).toEqual({ rootDir, mode: "compose" })
  })

  test("walks up to find compose when nothing closer matches", () => {
    composeAt(rootDir)
    const inner = join(rootDir, "a", "b", "c")
    mkdirSync(inner, { recursive: true })
    const r = findProjectRoot(inner)
    expect(r).toEqual({ rootDir, mode: "compose" })
  })

  test("walks up to find package.json#dx when nothing closer matches", () => {
    writeJson(join(rootDir, "package.json"), {
      name: "foo",
      dx: { tier: "marketing" },
    })
    const inner = join(rootDir, "src", "components")
    mkdirSync(inner, { recursive: true })
    const r = findProjectRoot(inner)
    expect(r).toEqual({ rootDir, mode: "package" })
  })

  test("returns null when no compose and no dx block found", () => {
    // Empty temp dir, no parents up to root will match either.
    // We can't prevent walk-up from finding something on the real FS,
    // but a temp dir under /tmp almost never has these — fine for sanity.
    const r = findProjectRoot(rootDir)
    // Either null (expected) or something-on-the-way-up (unlikely but
    // harmless) — just make sure it doesn't explode.
    if (r) {
      expect(r.rootDir).not.toBe(rootDir)
    }
  })

  test("rejects package.json with `dx` as an array", () => {
    writeJson(join(rootDir, "package.json"), { name: "foo", dx: [] })
    const r = findProjectRoot(rootDir)
    if (r) expect(r.rootDir).not.toBe(rootDir)
  })

  test("rejects package.json without `dx` block entirely", () => {
    writeJson(join(rootDir, "package.json"), { name: "foo" })
    const r = findProjectRoot(rootDir)
    if (r) expect(r.rootDir).not.toBe(rootDir)
  })

  test("malformed package.json is ignored, walk continues", () => {
    writeFileSync(join(rootDir, "package.json"), "{ this is not json")
    // Should not throw; just return null or a parent match.
    expect(() => findProjectRoot(rootDir)).not.toThrow()
  })
})

describe("detectPackageManager", () => {
  test("parses pnpm from packageManager field", () => {
    expect(detectPackageManager({ packageManager: "pnpm@9.15.4" })).toBe("pnpm")
  })

  test("parses bun", () => {
    expect(detectPackageManager({ packageManager: "bun@1.1.0" })).toBe("bun")
  })

  test("parses yarn", () => {
    expect(detectPackageManager({ packageManager: "yarn@4.5.0" })).toBe("yarn")
  })

  test("parses npm", () => {
    expect(detectPackageManager({ packageManager: "npm@10.0.0" })).toBe("npm")
  })

  test("handles +sha suffix (corepack)", () => {
    expect(
      detectPackageManager({
        packageManager: "pnpm@9.15.4+sha512.abc123",
      })
    ).toBe("pnpm")
  })

  test("defaults to pnpm when field is missing", () => {
    expect(detectPackageManager({})).toBe("pnpm")
  })

  test("defaults to pnpm for unknown managers", () => {
    expect(detectPackageManager({ packageManager: "zeus@1.0.0" })).toBe("pnpm")
  })

  test("defaults to pnpm for non-string field", () => {
    expect(detectPackageManager({ packageManager: 42 })).toBe("pnpm")
  })
})

describe("ProjectContext.fromPackageJson", () => {
  test("synthesizes a component from scripts.dev with correct package manager", () => {
    writeJson(join(rootDir, "package.json"), {
      name: "@lepton/marketing-foo",
      packageManager: "bun@1.1.0",
      dx: { tier: "marketing" },
      scripts: { dev: "astro dev" },
    })

    const ctx = ProjectContext.fromPackageJson(rootDir)
    expect(ctx.rootDir).toBe(rootDir)
    expect(ctx.composeFiles).toEqual([])
    expect(Object.keys(ctx.catalog.components)).toEqual(["marketing-foo"])
    // Dev command dispatched via bun, not pnpm.
    const comp = ctx.catalog.components["marketing-foo"]
    expect((comp!.spec as any).dev.command).toBe("bun run dev")
  })

  test("strips scope correctly and falls back to dir name if empty", () => {
    writeJson(join(rootDir, "package.json"), {
      name: "@scope/",
      dx: { tier: "marketing" },
      scripts: { dev: "x" },
    })
    const ctx = ProjectContext.fromPackageJson(rootDir)
    // "@scope/" strips to "" → falls back to basename(rootDir).
    const names = Object.keys(ctx.catalog.components)
    expect(names).toHaveLength(1)
    expect(names[0]).not.toBe("")
  })

  test("no scripts.dev → no component synthesized (orchestrator will surface)", () => {
    writeJson(join(rootDir, "package.json"), {
      name: "foo",
      dx: { tier: "marketing" },
    })
    const ctx = ProjectContext.fromPackageJson(rootDir)
    expect(Object.keys(ctx.catalog.components)).toEqual([])
  })

  test("reads owner from package.json author.name", () => {
    writeJson(join(rootDir, "package.json"), {
      name: "foo",
      dx: { tier: "marketing" },
      scripts: { dev: "x" },
      author: { name: "Team Foo", email: "team@example.com" },
    })
    const ctx = ProjectContext.fromPackageJson(rootDir)
    expect(ctx.catalog.spec.owner).toBe("Team Foo")
  })

  test("reads owner from author string", () => {
    writeJson(join(rootDir, "package.json"), {
      name: "foo",
      dx: { tier: "marketing" },
      scripts: { dev: "x" },
      author: "Alice",
    })
    const ctx = ProjectContext.fromPackageJson(rootDir)
    expect(ctx.catalog.spec.owner).toBe("Alice")
  })

  test("package.json#dx.dev.command overrides the default dev command", () => {
    writeJson(join(rootDir, "package.json"), {
      name: "foo",
      packageManager: "pnpm@9.15.4",
      dx: {
        tier: "marketing",
        dev: { command: "pnpm run dev -- --port $PORT" },
      },
      scripts: { dev: "astro dev" },
    })
    const ctx = ProjectContext.fromPackageJson(rootDir)
    const comp = ctx.catalog.components["foo"]
    expect((comp!.spec as any).dev.command).toBe("pnpm run dev -- --port $PORT")
  })

  test("defaults owner to 'unknown' when author missing", () => {
    writeJson(join(rootDir, "package.json"), {
      name: "foo",
      dx: { tier: "marketing" },
      scripts: { dev: "x" },
    })
    const ctx = ProjectContext.fromPackageJson(rootDir)
    expect(ctx.catalog.spec.owner).toBe("unknown")
  })
})
