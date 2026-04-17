import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  clearStamps,
  hashFiles,
  isStale,
  markFresh,
  readStamp,
  writeStamp,
} from "./state-cache.js"

let rootDir: string

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "state-cache-test-"))
})

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true })
})

describe("hashFiles", () => {
  test("produces stable hash for same content", () => {
    writeFileSync(join(rootDir, "a.txt"), "hello")
    const h1 = hashFiles(rootDir, ["a.txt"])
    const h2 = hashFiles(rootDir, ["a.txt"])
    expect(h1).toBe(h2)
    expect(h1).toHaveLength(64) // sha256 hex
  })

  test("different content produces different hash", () => {
    writeFileSync(join(rootDir, "a.txt"), "hello")
    const h1 = hashFiles(rootDir, ["a.txt"])
    writeFileSync(join(rootDir, "a.txt"), "world")
    const h2 = hashFiles(rootDir, ["a.txt"])
    expect(h1).not.toBe(h2)
  })

  test("order-independent — same files in different order hash equal", () => {
    writeFileSync(join(rootDir, "a.txt"), "aaa")
    writeFileSync(join(rootDir, "b.txt"), "bbb")
    const h1 = hashFiles(rootDir, ["a.txt", "b.txt"])
    const h2 = hashFiles(rootDir, ["b.txt", "a.txt"])
    expect(h1).toBe(h2)
  })

  test("missing files contribute a distinctive marker (not a crash)", () => {
    writeFileSync(join(rootDir, "a.txt"), "x")
    const withMissing = hashFiles(rootDir, ["a.txt", "does-not-exist"])
    const withoutMissing = hashFiles(rootDir, ["a.txt"])
    expect(withMissing).not.toBe(withoutMissing)
  })

  test("adding a new input file changes the hash", () => {
    writeFileSync(join(rootDir, "a.txt"), "x")
    const h1 = hashFiles(rootDir, ["a.txt"])
    writeFileSync(join(rootDir, "b.txt"), "y")
    const h2 = hashFiles(rootDir, ["a.txt", "b.txt"])
    expect(h1).not.toBe(h2)
  })

  test("file path is part of the hash, not just content", () => {
    writeFileSync(join(rootDir, "a.txt"), "same-content")
    writeFileSync(join(rootDir, "b.txt"), "same-content")
    const ha = hashFiles(rootDir, ["a.txt"])
    const hb = hashFiles(rootDir, ["b.txt"])
    // Same content, different file name → different hash, so renaming a file
    // with the same content still invalidates the cache key.
    expect(ha).not.toBe(hb)
  })
})

describe("stamp read/write", () => {
  test("readStamp returns null when no stamp exists", () => {
    expect(readStamp(rootDir, "nope")).toBeNull()
  })

  test("writeStamp then readStamp round-trips", () => {
    writeStamp(rootDir, "deps", "abc123")
    expect(readStamp(rootDir, "deps")).toBe("abc123")
  })

  test("writeStamp creates .dx/.state/ if missing", () => {
    writeStamp(rootDir, "tools", "xyz")
    expect(existsSync(join(rootDir, ".dx", ".state", "tools.stamp"))).toBe(true)
  })

  test("writeStamp overwrites existing stamp", () => {
    writeStamp(rootDir, "deps", "first")
    writeStamp(rootDir, "deps", "second")
    expect(readStamp(rootDir, "deps")).toBe("second")
  })
})

describe("isStale / markFresh", () => {
  test("first check is always stale (no prior stamp)", () => {
    writeFileSync(join(rootDir, "a.txt"), "v1")
    const result = isStale(rootDir, "demo", ["a.txt"])
    expect(result.stale).toBe(true)
    expect(result.hash).toHaveLength(64)
  })

  test("after markFresh, becomes not-stale", () => {
    writeFileSync(join(rootDir, "a.txt"), "v1")
    const check1 = isStale(rootDir, "demo", ["a.txt"])
    markFresh(rootDir, "demo", check1.hash)
    const check2 = isStale(rootDir, "demo", ["a.txt"])
    expect(check2.stale).toBe(false)
    expect(check2.hash).toBe(check1.hash)
  })

  test("mutating an input flips back to stale", () => {
    writeFileSync(join(rootDir, "a.txt"), "v1")
    const c1 = isStale(rootDir, "demo", ["a.txt"])
    markFresh(rootDir, "demo", c1.hash)
    writeFileSync(join(rootDir, "a.txt"), "v2")
    const c2 = isStale(rootDir, "demo", ["a.txt"])
    expect(c2.stale).toBe(true)
    expect(c2.hash).not.toBe(c1.hash)
  })

  test("different stamp keys are independent", () => {
    writeFileSync(join(rootDir, "a.txt"), "v1")
    const c = isStale(rootDir, "foo", ["a.txt"])
    markFresh(rootDir, "foo", c.hash)
    // Another key with same inputs should still be stale (never marked fresh).
    expect(isStale(rootDir, "bar", ["a.txt"]).stale).toBe(true)
    // And the original one is still fresh.
    expect(isStale(rootDir, "foo", ["a.txt"]).stale).toBe(false)
  })

  test("isStale does not create any files", () => {
    writeFileSync(join(rootDir, "a.txt"), "x")
    isStale(rootDir, "demo", ["a.txt"])
    expect(existsSync(join(rootDir, ".dx"))).toBe(false)
  })
})

describe("clearStamps", () => {
  test("removes all .stamp files but leaves dir intact", () => {
    writeStamp(rootDir, "a", "1")
    writeStamp(rootDir, "b", "2")
    // Put a non-stamp file to make sure we only touch stamps.
    const stateDir = join(rootDir, ".dx", ".state")
    writeFileSync(join(stateDir, "other.txt"), "keep-me")

    clearStamps(rootDir)

    expect(readStamp(rootDir, "a")).toBeNull()
    expect(readStamp(rootDir, "b")).toBeNull()
    expect(existsSync(join(stateDir, "other.txt"))).toBe(true)
  })

  test("no-op when state dir doesn't exist", () => {
    expect(() => clearStamps(rootDir)).not.toThrow()
  })
})
