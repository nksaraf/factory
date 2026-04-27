/**
 * dx source unlink — remove a source-linked checkout.
 *
 * For required sources: also removes from package.json#dx.sources and
 * cleans up docker compose build block.
 * With --local-only: removes local checkout only, keeps committed config.
 */

import { existsSync, lstatSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { PackageState } from "../pkg/state.js"
import { gitStatusSummary } from "../pkg/detect.js"
import { removeGitignoreEntry } from "../pkg/gitignore.js"
import { unintegrateNpm, unintegrateJava } from "../pkg/integrate.js"
import { removeWorktree } from "../pkg/shared-repo.js"
import { readSources, removeSource } from "./sources-config.js"
import {
  removeBuildFromCompose,
  removeSourceOverride,
  findComposeServiceBySource,
} from "./docker-override.js"

export interface SourceUnlinkOptions {
  package: string
  force?: boolean
  localOnly?: boolean
  verbose?: boolean
}

export async function sourceUnlink(
  root: string,
  opts: SourceUnlinkOptions
): Promise<void> {
  const pm = new PackageState(root)
  const entry = pm.get(opts.package)
  if (!entry) {
    throw new Error(`Source '${opts.package}' is not linked`)
  }

  const pkgDir = join(root, entry.local_path)

  // Check for uncommitted changes
  if (!opts.force) {
    const { status, count } = await gitStatusSummary(entry, root)
    if (status === "modified") {
      throw new Error(
        `Source '${opts.package}' has ${count} uncommitted change(s)\n` +
          "Use 'dx source push' first, or 'dx source unlink --force' to discard"
      )
    }
  }

  // Remove worktree / symlink
  if (entry.is_worktree && entry.shared_repo) {
    let isSymlink = false
    try {
      isSymlink = lstatSync(pkgDir).isSymbolicLink()
    } catch {}

    if (isSymlink) {
      unlinkSync(pkgDir)
      console.log(`Removed symlink ${entry.local_path}`)
    }

    const worktreePath = entry.repo_path ? join(root, entry.repo_path) : pkgDir
    if (existsSync(worktreePath)) {
      await removeWorktree(entry.shared_repo, worktreePath)
      console.log(`Removed worktree ${entry.repo_path ?? entry.local_path}`)
    }
  }

  // Unintegrate from build system
  if (entry.type === "npm") await unintegrateNpm(root, entry.npm_name)
  else if (entry.type === "java") unintegrateJava(root, opts.package)

  // Handle required vs optional cleanup
  const sources = readSources(root)
  const isRequired = opts.package in sources

  // Find the matching compose service for docker cleanup
  const svcName = findComposeServiceBySource(
    root,
    entry.source,
    entry.source_path
  )

  if (isRequired && !opts.localOnly) {
    // Remove from committed config
    removeSource(root, opts.package)
    console.log(`Removed ${opts.package} from package.json dx.sources`)

    // Remove build block from docker-compose.yaml
    if (svcName) {
      removeBuildFromCompose(root, svcName)
    }
  } else {
    // Remove .gitignore entry (optional links only)
    removeGitignoreEntry(root, entry.local_path + "/")

    // Remove override file entry
    if (svcName) {
      removeSourceOverride(root, svcName)
    }
  }

  // Remove from runtime state
  pm.remove(opts.package)
  console.log(`Source '${opts.package}' unlinked`)
}
