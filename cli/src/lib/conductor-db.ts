/**
 * Conductor SQLite DB integration — register/unregister worktree workspaces.
 *
 * Best-effort: all public functions silently no-op if Conductor isn't installed
 * or the DB is unavailable.
 */
import { Database } from "bun:sqlite"
import { basename } from "node:path"

import { getRemoteUrl } from "./git.js"
import { getConductorDbPath } from "./ingest/common.js"

// ── Types ────────────────────────────────────────────────────

interface RegisterWorkspaceParams {
  name: string
  branch: string
  worktreePath: string
  repoDir: string
}

// ── Repo resolution ──────────────────────────────────────────

function findOrCreateRepo(
  db: Database,
  repoDir: string,
  worktreePath: string
): string | null {
  let remoteUrl: string | undefined
  try {
    remoteUrl = getRemoteUrl(worktreePath)
  } catch {
    try {
      remoteUrl = getRemoteUrl(repoDir)
    } catch {
      return null
    }
  }

  // Try to find existing repo by remote_url
  if (remoteUrl) {
    const byUrl = db
      .prepare("SELECT id FROM repos WHERE remote_url = ?")
      .get(remoteUrl) as { id: string } | null
    if (byUrl) return byUrl.id
  }

  // Fallback: find by root_path
  const byPath = db
    .prepare("SELECT id FROM repos WHERE root_path = ?")
    .get(repoDir) as { id: string } | null
  if (byPath) return byPath.id

  // Create new repo
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO repos (id, remote_url, name, root_path) VALUES (?, ?, ?, ?)`
  ).run(id, remoteUrl ?? null, basename(repoDir), repoDir)

  return id
}

// ── Public API ───────────────────────────────────────────────

export function registerWorkspaceInConductorDb(
  params: RegisterWorkspaceParams
): void {
  try {
    const dbPath = getConductorDbPath()
    if (!dbPath) return

    const db = new Database(dbPath)
    try {
      db.transaction(() => {
        const repoId = findOrCreateRepo(db, params.repoDir, params.worktreePath)
        if (!repoId) return // Can't register without a repo

        // Check if workspace already exists (scoped by repo)
        const existing = db
          .prepare(
            "SELECT id FROM workspaces WHERE directory_name = ? AND repository_id = ?"
          )
          .get(params.name, repoId) as { id: string } | null

        if (existing) {
          db.prepare(
            `UPDATE workspaces SET branch = ?, state = 'active', updated_at = datetime('now') WHERE id = ?`
          ).run(params.branch, existing.id)
        } else {
          const id = crypto.randomUUID()
          db.prepare(
            `INSERT INTO workspaces (id, repository_id, directory_name, branch, state, derived_status)
             VALUES (?, ?, ?, ?, 'active', 'in-progress')`
          ).run(id, repoId, params.name, params.branch)
        }
      })()
    } finally {
      db.close()
    }
  } catch {
    // Best-effort: silently ignore failures
  }
}

export function unregisterWorkspaceFromConductorDb(
  name: string,
  repoDir: string
): void {
  try {
    const dbPath = getConductorDbPath()
    if (!dbPath) return

    const db = new Database(dbPath)
    try {
      db.prepare(
        `UPDATE workspaces SET state = 'archived', updated_at = datetime('now')
         WHERE directory_name = ? AND repository_id = (SELECT id FROM repos WHERE root_path = ?)`
      ).run(name, repoDir)
    } finally {
      db.close()
    }
  } catch {
    // Best-effort: silently ignore failures
  }
}
