/**
 * Detect and repoint dx-managed symlinks whose target escaped this workspace.
 *
 * Conductor (and any tool that copies a workspace) preserves absolute symlink
 * targets, so a link created in workspace A keeps pointing at A even after
 * the directory is cloned into workspace B. This heals those by repointing
 * each entry's local_path at the local worktree it should reference.
 */

import { lstatSync, readlinkSync, unlinkSync, symlinkSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { PackageState, type PackageEntry } from "./state.js"

export interface HealResult {
  /** Names of entries whose symlinks were repointed at the local worktree. */
  repointed: string[]
  /** Names of entries with stale targets we couldn't heal (worktree missing). */
  unhealed: string[]
}

export function healManagedSymlinks(root: string): HealResult {
  const pm = new PackageState(root)
  const entries = pm.all()
  const repointed: string[] = []
  const unhealed: string[] = []

  for (const [name, entry] of Object.entries(entries)) {
    const linkPath = join(root, entry.local_path)
    const stat = lstatSync(linkPath, { throwIfNoEntry: false })
    if (!stat?.isSymbolicLink()) continue

    const expected = expectedTarget(root, entry)
    if (!expected) continue

    const current = readlinkSync(linkPath)
    const resolved = isAbsolute(current)
      ? current
      : resolve(dirname(linkPath), current)

    if (resolved === expected) continue

    // Don't try to heal if the local worktree we'd repoint at is missing.
    const expectedStat = lstatSync(expected, { throwIfNoEntry: false })
    if (!expectedStat) {
      unhealed.push(name)
      continue
    }

    unlinkSync(linkPath)
    symlinkSync(relative(dirname(linkPath), expected), linkPath)
    repointed.push(name)
  }

  return { repointed, unhealed }
}

/**
 * Where the symlink at entry.local_path *should* point in this workspace.
 * Only monorepo links (entry.repo_path + entry.source_path) need a symlink;
 * single-repo links use the worktree as the package directory directly.
 */
function expectedTarget(root: string, entry: PackageEntry): string | undefined {
  if (!entry.is_worktree || !entry.repo_path) return undefined
  const worktree = join(root, entry.repo_path)
  return entry.source_path ? join(worktree, entry.source_path) : worktree
}
