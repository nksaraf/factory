/**
 * dx source link — check out an external source for local development.
 *
 * Supports two modes:
 *   - Optional (default): local-only dev link, state in .dx/packages.json
 *   - Required (--require): committed in package.json#dx.sources, restored by dx sync
 *
 * Uses shared bare clones at ~/.dx/shared-repos/ with git worktrees.
 */

import { existsSync, lstatSync, mkdirSync, symlinkSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { generateBranchSlug } from "@smp/factory-shared/slug"
import { capture } from "../../lib/subprocess.js"
import { PackageState, type PackageEntry } from "../pkg/state.js"
import { resolveSource, deriveName, shortSource } from "../pkg/detect.js"
import { addGitignoreEntry } from "../pkg/gitignore.js"
import { integrateNpm, integrateJava } from "../pkg/integrate.js"
import { readPackageName } from "../pkg/pnpm-overrides.js"
import {
  ensureSharedClone,
  addWorktree,
  detectPkgTypeFromBare,
} from "../pkg/shared-repo.js"
import { writeSource } from "./sources-config.js"
import {
  addBuildToCompose,
  generateSourceOverride,
  findComposeService,
} from "./docker-override.js"

export interface SourceLinkOptions {
  source: string
  path?: string
  target?: string
  as?: string
  ref?: string
  branch?: string
  require?: boolean
  verbose?: boolean
  /** Internal: skip push and config write when restoring from dx sync. */
  restore?: boolean
  /** Suppress console output (used by dx sync). */
  quiet?: boolean
}

export async function sourceLink(
  root: string,
  opts: SourceLinkOptions
): Promise<void> {
  const log = opts.quiet
    ? (..._args: unknown[]) => {}
    : (...args: unknown[]) => console.log(...args)

  // 1. Try catalog-aware resolution: if source matches a compose service name
  const catalogResolved = resolveCatalogSource(root, opts.source)
  const effectiveSource = catalogResolved?.gitUrl ?? opts.source
  const effectivePath = opts.path ?? catalogResolved?.path
  const composeServiceName = catalogResolved?.serviceName

  const gitUrl = resolveSource(effectiveSource)
  const name = deriveName(effectiveSource, effectivePath, opts.as)

  if (catalogResolved) {
    log(
      `Resolved ${opts.source} → ${shortSource(gitUrl)}${effectivePath ? `:${effectivePath}` : ""}`
    )
  }

  // 2. Determine target directory
  const target = resolveTarget(root, name, opts.target)

  log(`Checking out ${name} from ${shortSource(gitUrl)}...`)

  // 3. Ensure shared bare clone exists and is up-to-date
  const sharedRepo = await ensureSharedClone(gitUrl, {
    verbose: opts.verbose,
  })

  // 4. Detect the default branch (always the repo's actual default, not the ref override)
  const defaultBranch = await resolveDefaultBranch(sharedRepo)

  // 5. Detect package type from bare repo
  const startPoint = opts.ref ?? defaultBranch
  const pkgType =
    (await detectPkgTypeFromBare(sharedRepo, startPoint, effectivePath)) ??
    "npm"

  // 6. Check target doesn't already exist.
  //    Use lstat (not existsSync, which follows symlinks): a broken symlink
  //    left by a previous workspace must surface as a clear error rather than
  //    EEXIST from symlinkSync.
  const targetPath = join(root, target)
  const targetEntry = lstatSync(targetPath, { throwIfNoEntry: false })
  if (targetEntry) {
    if (targetEntry.isSymbolicLink()) {
      throw new Error(
        `Target is an existing symlink: ${target}\n  Remove it first: rm ${target}`
      )
    }
    throw new Error(`Target directory already exists: ${target}`)
  }

  // 7. Generate unique branch name
  const checkoutBranch = opts.branch ?? `dx/${name}-dev-${generateBranchSlug()}`

  mkdirSync(join(targetPath, ".."), { recursive: true })

  let repoPath: string | undefined

  if (effectivePath) {
    // Monorepo source: worktree in .dx/pkg-repos/<name>/, symlink subpath
    const reposDir = join(root, ".dx", "pkg-repos")
    mkdirSync(reposDir, { recursive: true })
    const worktreeDest = join(reposDir, name)

    await addWorktree(sharedRepo, worktreeDest, checkoutBranch, startPoint)

    const pkgSource = join(worktreeDest, effectivePath)
    if (!existsSync(pkgSource)) {
      throw new Error(`Path ${effectivePath} does not exist in the cloned repo`)
    }

    // Relative target so cloning the workspace (e.g. via Conductor)
    // doesn't carry an absolute path back at the original workspace.
    symlinkSync(relative(dirname(targetPath), pkgSource), targetPath)
    repoPath = relative(root, worktreeDest)
  } else {
    // Single-repo source: worktree IS the target directory
    await addWorktree(sharedRepo, targetPath, checkoutBranch, startPoint)
  }

  log(`Checked out into ${target}`)

  // 8. Save runtime state
  const pm = new PackageState(root)
  const entry: PackageEntry = {
    source: gitUrl,
    source_path: effectivePath,
    type: pkgType,
    local_path: target,
    branch: defaultBranch,
    checkout_branch: checkoutBranch,
    checked_out_at: new Date().toISOString(),
    mode: "link",
    shared_repo: sharedRepo,
    is_worktree: true,
  }
  if (repoPath) entry.repo_path = repoPath

  // Capture the linked source's npm name for pnpm.overrides management.
  if (pkgType === "npm") {
    const npmName = readPackageName(targetPath)
    if (npmName) entry.npm_name = npmName
  }
  pm.add(name, entry)

  // 9. Integrate with build system
  if (pkgType === "npm") {
    await integrateNpm(root, {
      npmName: entry.npm_name,
      localPath: entry.local_path,
    })
  } else if (pkgType === "java") {
    await integrateJava(root, name)
  }

  // 10. Handle required vs optional
  if (opts.require) {
    if (!opts.restore) {
      // Write to committed config (skip on restore — already in config)
      writeSource(root, name, {
        source: shortSource(gitUrl),
        path: effectivePath,
        target,
        ref: opts.ref,
      })
      log(`Added ${name} to package.json dx.sources (required)`)

      // Push branch so team members can fetch
      const repoDir = repoPath ? join(root, repoPath) : targetPath
      const pushResult = await capture(
        ["git", "push", "-u", "origin", checkoutBranch],
        { cwd: repoDir }
      )
      if (pushResult.exitCode === 0) {
        log(`Pushed branch ${checkoutBranch}`)
      }

      // Docker: add build block to main docker-compose.yaml
      if (composeServiceName) {
        const hasDockerfile = existsSync(join(targetPath, "Dockerfile"))
        if (hasDockerfile) {
          addBuildToCompose(root, composeServiceName, target)
          log(
            `Added build context to ${composeServiceName} in docker-compose.yaml`
          )
        }
      }
    }
  } else {
    // Optional: add to .gitignore
    addGitignoreEntry(root, target + "/")

    // Docker: generate override file
    if (composeServiceName) {
      const hasDockerfile = existsSync(join(targetPath, "Dockerfile"))
      if (hasDockerfile) {
        generateSourceOverride(root, composeServiceName, target)
        log(`Generated docker compose override for ${composeServiceName}`)
      }
    }
  }

  log(`Source ${name} is ready for development`)
  log(`  Branch: ${checkoutBranch}`)
  log(`  Edit files in ${target}/`)
  log(`  Run 'dx source diff ${name}' to see changes`)
  log(`  Run 'dx source push ${name}' when ready to submit`)
}

/**
 * Resolve the target directory for a source link.
 * Required: must be explicit (from --target flag or sources config).
 */
function resolveTarget(
  root: string,
  name: string,
  targetOverride?: string
): string {
  if (targetOverride) return targetOverride

  throw new Error(
    `No target directory specified. Use --target <dir> to specify where to place the source.\n` +
      `  Example: dx source link <source> --target packages/npm/${name}`
  )
}

/**
 * Try to resolve a source argument as a catalog component/resource name.
 * Looks for dx.source.repo and dx.source.path labels on compose services.
 */
function resolveCatalogSource(
  root: string,
  source: string
): {
  gitUrl: string
  path?: string
  serviceName: string
} | null {
  // Only try catalog resolution for names that look like service names (no slashes, no URLs)
  if (source.includes("/") || source.includes(":") || source.startsWith(".")) {
    return null
  }

  const result = findComposeService(root, source)
  if (!result) return null

  return {
    gitUrl: result.sourceRepo,
    path: result.sourcePath,
    serviceName: result.serviceName,
  }
}

async function resolveDefaultBranch(sharedRepo: string): Promise<string> {
  const result = await capture(["git", "symbolic-ref", "--short", "HEAD"], {
    cwd: sharedRepo,
  })
  return result.exitCode === 0 ? result.stdout.trim() : "main"
}
