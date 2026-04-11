import { beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  appendIfMissing,
  deepMergeJsonConfig,
  ensureFileExists,
  readJsonConfig,
  readManagedBlock,
  upsertDotfile,
  upsertManagedBlock,
} from "../handlers/install/defaults/file-utils.js"

function tmpFile(name: string): { dir: string; path: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dx-file-utils-"))
  return { dir, path: path.join(dir, name) }
}

describe("upsertDotfile", () => {
  it("creates file and adds key=value when file does not exist", () => {
    const f = tmpFile(".npmrc")
    upsertDotfile(f.path, "save-exact", "true")
    expect(readFileSync(f.path, "utf8")).toContain("save-exact=true")
  })

  it("updates existing key", () => {
    const f = tmpFile(".npmrc")
    writeFileSync(f.path, "save-exact=false\nfund=false\n")
    upsertDotfile(f.path, "save-exact", "true")
    const content = readFileSync(f.path, "utf8")
    expect(content).toContain("save-exact=true")
    expect(content).toContain("fund=false")
    expect(content).not.toContain("save-exact=false")
  })

  it("preserves comments and blank lines", () => {
    const f = tmpFile(".npmrc")
    writeFileSync(f.path, "# my comment\n\nfund=false\n")
    upsertDotfile(f.path, "save-exact", "true")
    const content = readFileSync(f.path, "utf8")
    expect(content).toContain("# my comment")
    expect(content).toContain("fund=false")
    expect(content).toContain("save-exact=true")
  })
})

describe("upsertManagedBlock", () => {
  it("creates block in new file", () => {
    const f = tmpFile("config")
    upsertManagedBlock(f.path, ["line1", "line2"])
    const content = readFileSync(f.path, "utf8")
    expect(content).toContain("# --- BEGIN dx-managed ---")
    expect(content).toContain("line1")
    expect(content).toContain("line2")
    expect(content).toContain("# --- END dx-managed ---")
  })

  it("replaces existing block on re-run", () => {
    const f = tmpFile("config")
    writeFileSync(
      f.path,
      "existing content\n# --- BEGIN dx-managed ---\nold\n# --- END dx-managed ---\nmore content\n"
    )
    upsertManagedBlock(f.path, ["new1", "new2"])
    const content = readFileSync(f.path, "utf8")
    expect(content).toContain("existing content")
    expect(content).toContain("new1")
    expect(content).toContain("new2")
    expect(content).not.toContain("old")
    expect(content).toContain("more content")
  })

  it("appends block to existing file without block", () => {
    const f = tmpFile("config")
    writeFileSync(f.path, "existing content")
    upsertManagedBlock(f.path, ["added"])
    const content = readFileSync(f.path, "utf8")
    expect(content).toContain("existing content")
    expect(content).toContain("added")
  })
})

describe("readManagedBlock", () => {
  it("returns null when file does not exist", () => {
    expect(readManagedBlock("/nonexistent")).toBeNull()
  })

  it("returns null when no block exists", () => {
    const f = tmpFile("config")
    writeFileSync(f.path, "no block here\n")
    expect(readManagedBlock(f.path)).toBeNull()
  })

  it("returns lines between markers", () => {
    const f = tmpFile("config")
    writeFileSync(
      f.path,
      "before\n# --- BEGIN dx-managed ---\nfoo\nbar\n# --- END dx-managed ---\nafter\n"
    )
    expect(readManagedBlock(f.path)).toEqual(["foo", "bar"])
  })
})

describe("appendIfMissing", () => {
  it("appends lines not already present", () => {
    const f = tmpFile("config")
    writeFileSync(f.path, "existing\n")
    appendIfMissing(f.path, ["existing", "new"])
    const content = readFileSync(f.path, "utf8")
    const lines = content.split("\n").filter(Boolean)
    // "existing" should appear once, "new" once
    expect(lines.filter((l) => l === "existing")).toHaveLength(1)
    expect(lines).toContain("new")
  })

  it("creates file if it does not exist", () => {
    const f = tmpFile("config")
    appendIfMissing(f.path, ["line1", "line2"])
    const content = readFileSync(f.path, "utf8")
    expect(content).toContain("line1")
    expect(content).toContain("line2")
  })
})

describe("deepMergeJsonConfig", () => {
  it("creates file with proposed values when file does not exist", () => {
    const f = tmpFile("config.json")
    deepMergeJsonConfig(f.path, { key: "value", nested: { a: 1 } })
    const result = readJsonConfig(f.path)
    expect(result).toEqual({ key: "value", nested: { a: 1 } })
  })

  it("deep merges with existing values", () => {
    const f = tmpFile("config.json")
    writeFileSync(
      f.path,
      JSON.stringify({ existing: true, nested: { a: 1, b: 2 } })
    )
    deepMergeJsonConfig(f.path, { nested: { a: 99, c: 3 }, added: "yes" })
    const result = readJsonConfig(f.path)
    expect(result).toEqual({
      existing: true,
      nested: { a: 99, b: 2, c: 3 },
      added: "yes",
    })
  })

  it("never removes existing keys", () => {
    const f = tmpFile("config.json")
    writeFileSync(f.path, JSON.stringify({ keep: "me", overwrite: "old" }))
    deepMergeJsonConfig(f.path, { overwrite: "new" })
    const result = readJsonConfig(f.path)
    expect(result.keep).toBe("me")
    expect(result.overwrite).toBe("new")
  })
})

describe("ensureFileExists", () => {
  it("creates file with content when it does not exist", () => {
    const f = tmpFile("template.txt")
    ensureFileExists(f.path, "template content")
    expect(readFileSync(f.path, "utf8")).toBe("template content")
  })

  it("does not overwrite existing file", () => {
    const f = tmpFile("template.txt")
    writeFileSync(f.path, "original")
    ensureFileExists(f.path, "new content")
    expect(readFileSync(f.path, "utf8")).toBe("original")
  })
})
