import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { detectServiceType } from "./detect-service-type.js"

let testDir: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "detect-type-"))
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe("detectServiceType", () => {
  test("detects node when package.json exists", () => {
    writeFileSync(join(testDir, "package.json"), '{"name":"test"}', "utf8")
    expect(detectServiceType(testDir)).toBe("node")
  })

  test("detects python when pyproject.toml exists", () => {
    writeFileSync(join(testDir, "pyproject.toml"), "", "utf8")
    expect(detectServiceType(testDir)).toBe("python")
  })

  test("detects python when setup.py exists", () => {
    writeFileSync(join(testDir, "setup.py"), "", "utf8")
    expect(detectServiceType(testDir)).toBe("python")
  })

  test("detects java when pom.xml exists", () => {
    writeFileSync(join(testDir, "pom.xml"), "", "utf8")
    expect(detectServiceType(testDir)).toBe("java")
  })

  test("detects java when build.gradle exists", () => {
    writeFileSync(join(testDir, "build.gradle"), "", "utf8")
    expect(detectServiceType(testDir)).toBe("java")
  })

  test("returns null for empty directory", () => {
    expect(detectServiceType(testDir)).toBeNull()
  })

  test("package.json takes priority over other markers", () => {
    writeFileSync(join(testDir, "package.json"), '{"name":"test"}', "utf8")
    writeFileSync(join(testDir, "pyproject.toml"), "", "utf8")
    writeFileSync(join(testDir, "pom.xml"), "", "utf8")
    expect(detectServiceType(testDir)).toBe("node")
  })
})
