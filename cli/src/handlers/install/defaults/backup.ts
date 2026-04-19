import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { basename, join } from "node:path"

import { DX_DATA_DIR } from "../../../lib/host-dirs.js"

const BACKUP_DIR = join(DX_DATA_DIR, "backups")
const MANIFEST_PATH = join(BACKUP_DIR, "manifest.json")

/** Ensure the backup directory exists. */
function ensureBackupDir(): void {
  mkdirSync(BACKUP_DIR, { recursive: true })
}

/** Read the backup manifest (maps backup filename → original path). */
function readManifest(): Record<string, string> {
  if (!existsSync(MANIFEST_PATH)) return {}
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))
  } catch {
    return {}
  }
}

/** Write the backup manifest. */
function writeManifest(manifest: Record<string, string>): void {
  ensureBackupDir()
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n")
}

/**
 * Backup a file before modification.
 * Creates `~/.dx/backups/<filename>.<ISO-timestamp>.bak`
 * Returns the backup path, or null if the file didn't exist.
 */
let backupCounter = 0

export function backupFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null
  ensureBackupDir()
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const name = basename(filePath)
  // Include counter to avoid collisions when multiple backups happen in the same millisecond
  const backupName = `${name}.${stamp}-${++backupCounter}.bak`
  const backupPath = join(BACKUP_DIR, backupName)
  copyFileSync(filePath, backupPath)

  // Record original path in manifest
  const manifest = readManifest()
  manifest[backupName] = filePath
  writeManifest(manifest)

  return backupPath
}

export interface BackupEntry {
  path: string
  name: string
  mtime: Date
  originalPath: string | null
}

/** List all backups, optionally filtered by original filename prefix. */
export function listBackups(filenamePrefix?: string): BackupEntry[] {
  if (!existsSync(BACKUP_DIR)) return []
  const manifest = readManifest()
  const entries = readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".bak"))
    .filter((f) => !filenamePrefix || f.startsWith(filenamePrefix))

  return entries
    .map((name) => {
      const path = join(BACKUP_DIR, name)
      const mtime = statSync(path).mtime
      return { path, name, mtime, originalPath: manifest[name] ?? null }
    })
    .sort(
      (a, b) =>
        b.mtime.getTime() - a.mtime.getTime() || b.name.localeCompare(a.name)
    )
}

/** Restore a specific backup file to a target path. */
export function restoreBackup(backupPath: string, targetPath: string): boolean {
  if (!existsSync(backupPath)) return false
  copyFileSync(backupPath, targetPath)
  return true
}

/**
 * Find the most recent backup matching a filename prefix and restore it.
 * Returns the restored backup path, or null if no backup found.
 */
export function restoreLatest(
  filenamePrefix: string,
  targetPath: string
): string | null {
  const backups = listBackups(filenamePrefix)
  if (backups.length === 0) return null
  const latest = backups[0]!
  copyFileSync(latest.path, targetPath)
  return latest.path
}

/** Get the backup directory path. */
export function getBackupDir(): string {
  return BACKUP_DIR
}
