/**
 * Shared bare clone pool + git worktree management.
 *
 * Instead of cloning repos per-workspace, we maintain a single bare clone
 * at ~/.dx/shared-repos/<key>/ and create worktrees for each workspace.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { exec, capture } from "../../lib/subprocess.js"

/** Derive a deterministic directory name from a git URL. */
export function normalizeGitUrl(gitUrl: string): string {
  return gitUrl
    .replace(/^(?:https?:\/\/|git@|ssh:\/\/)/, "")
    .replace(/\.git$/, "")
    .replace(/[/:@]/g, "-")
    .toLowerCase()
}

/** Return the shared bare-clone directory for a git URL. */
export function sharedRepoDir(gitUrl: string): string {
  return join(homedir(), ".dx", "shared-repos", normalizeGitUrl(gitUrl))
}

/**
 * Ensure a shared bare clone exists and is up-to-date.
 * Returns the absolute path to the bare repo.
 */
export async function ensureSharedClone(
  gitUrl: string,
  opts?: { verbose?: boolean }
): Promise<string> {
  const repoDir = sharedRepoDir(gitUrl)
  const lockDir = `${repoDir}.lock`

  // Simple directory-based lock (mkdirSync is atomic)
  await acquireLock(lockDir)
  try {
    if (existsSync(join(repoDir, "HEAD"))) {
      // Existing bare repo — fetch latest and prune stale worktrees
      if (opts?.verbose) console.log(`Updating shared clone at ${repoDir}`)
      await exec(["git", "fetch", "origin"], { cwd: repoDir })
      await exec(["git", "worktree", "prune"], { cwd: repoDir })
    } else {
      // Fresh clone
      mkdirSync(join(repoDir, ".."), { recursive: true })
      console.log(`Creating shared clone for ${gitUrl}...`)
      await exec(["git", "clone", "--bare", gitUrl, repoDir])
    }
  } finally {
    releaseLock(lockDir)
  }

  return repoDir
}

/** Create a worktree from the shared bare clone. */
export async function addWorktree(
  sharedRepo: string,
  worktreePath: string,
  branch: string,
  startPoint: string
): Promise<void> {
  mkdirSync(join(worktreePath, ".."), { recursive: true })
  await exec(
    ["git", "worktree", "add", worktreePath, "-b", branch, startPoint],
    { cwd: sharedRepo }
  )
}

/** Remove a worktree and prune the bare clone. */
export async function removeWorktree(
  sharedRepo: string,
  worktreePath: string
): Promise<void> {
  await exec(["git", "worktree", "remove", worktreePath, "--force"], {
    cwd: sharedRepo,
  })
  await exec(["git", "worktree", "prune"], { cwd: sharedRepo })
}

/**
 * Detect package type from a bare repo without creating a worktree.
 * Probes for package.json, pom.xml, or pyproject.toml via git cat-file.
 */
export async function detectPkgTypeFromBare(
  sharedRepo: string,
  ref: string,
  subpath?: string
): Promise<"npm" | "java" | "python" | null> {
  const prefix = subpath ? `${subpath}/` : ""
  const checks: Array<{ file: string; type: "npm" | "java" | "python" }> = [
    { file: `${prefix}package.json`, type: "npm" },
    { file: `${prefix}pom.xml`, type: "java" },
    { file: `${prefix}pyproject.toml`, type: "python" },
  ]

  for (const { file, type } of checks) {
    const result = await capture(["git", "cat-file", "-e", `${ref}:${file}`], {
      cwd: sharedRepo,
    })
    if (result.exitCode === 0) return type
  }
  return null
}

// ---------------------------------------------------------------------------
// Lock helpers
// ---------------------------------------------------------------------------

const LOCK_STALE_MS = 5 * 60_000 // 5 minutes

async function acquireLock(lockDir: string): Promise<void> {
  // Ensure parent directory exists first (this is idempotent, not the lock)
  mkdirSync(join(lockDir, ".."), { recursive: true })

  const maxRetries = 30
  for (let i = 0; i < maxRetries; i++) {
    try {
      mkdirSync(lockDir) // atomic — fails if already exists
      // Write our PID so staleness can be checked
      writeFileSync(join(lockDir, "pid"), String(process.pid))
      return
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err
      // Lock exists — check if stale
      if (isLockStale(lockDir)) {
        rmSync(lockDir, { recursive: true, force: true })
        continue
      }
      // Wait and retry
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  throw new Error(`Could not acquire lock: ${lockDir} (after ${maxRetries}s)`)
}

function releaseLock(lockDir: string): void {
  rmSync(lockDir, { recursive: true, force: true })
}

function isLockStale(lockDir: string): boolean {
  try {
    const pidFile = join(lockDir, "pid")
    if (!existsSync(pidFile)) return true
    const pid = Number(readFileSync(pidFile, "utf8").trim())
    if (isNaN(pid)) return true
    // Check if process is alive
    try {
      process.kill(pid, 0)
      return false // Process alive — not stale
    } catch {
      return true // Process gone — stale
    }
  } catch {
    return true
  }
}
