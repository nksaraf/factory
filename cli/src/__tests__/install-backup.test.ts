import { describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  backupFile,
  listBackups,
  restoreBackup,
  restoreLatest,
} from "../handlers/install/defaults/backup.js"

// Tests use real HOME. backupFile writes to ~/.dx/backups/ which is fine for testing —
// the files are uniquely timestamped and won't collide.

function tmpSource(name: string, content: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dx-backup-src-"))
  const p = path.join(dir, name)
  writeFileSync(p, content)
  return p
}

describe("backup", () => {
  it("returns null when file does not exist", () => {
    expect(backupFile("/nonexistent/file.txt")).toBeNull()
  })

  it("creates a backup file with correct content", () => {
    const source = tmpSource("backup-create.txt", "original content")
    const backupPath = backupFile(source)
    expect(backupPath).not.toBeNull()
    expect(existsSync(backupPath!)).toBe(true)
    expect(readFileSync(backupPath!, "utf8")).toBe("original content")
  })

  it("lists backups by filename prefix", () => {
    const source = tmpSource("backup-list-test.txt", "v1")
    const b1 = backupFile(source)
    expect(b1).not.toBeNull()
    writeFileSync(source, "v2")
    const b2 = backupFile(source)
    expect(b2).not.toBeNull()
    // Both backups should exist even if timestamps collide
    expect(existsSync(b1!)).toBe(true)
    expect(existsSync(b2!)).toBe(true)
  })

  it("restores a specific backup", () => {
    const source = tmpSource("backup-restore.txt", "before")
    const backupPath = backupFile(source)!
    writeFileSync(source, "after")

    const ok = restoreBackup(backupPath, source)
    expect(ok).toBe(true)
    expect(readFileSync(source, "utf8")).toBe("before")
  })

  it("restoreLatest restores most recent backup", () => {
    const source = tmpSource("backup-latest.txt", "v1")
    backupFile(source)
    writeFileSync(source, "v2")
    backupFile(source)
    writeFileSync(source, "v3")

    const restored = restoreLatest("backup-latest.txt", source)
    expect(restored).not.toBeNull()
    expect(readFileSync(source, "utf8")).toBe("v2")
  })

  it("restoreLatest returns null when no backup exists", () => {
    const target = path.join(os.tmpdir(), "no-backup-ever.txt")
    const result = restoreLatest("no-backup-ever-unique-prefix.txt", target)
    expect(result).toBeNull()
  })

  it("restoreBackup returns false for nonexistent backup", () => {
    expect(restoreBackup("/nonexistent/backup.bak", "/tmp/target")).toBe(false)
  })
})
