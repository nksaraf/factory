/**
 * dx pkg contribute — contribute a local package to an external repo.
 * Also exports sync helpers used by push/pull for contribute-mode packages.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, relative } from "node:path"
import { exec, capture } from "../../lib/subprocess.js"
import { PackageState, type PackageEntry } from "./state.js"
import { resolveSource, detectPkgType, shortSource } from "./detect.js"
import { buildCopyFilter } from "./copy-filter.js"
import { generateBranchSlug } from "@smp/factory-shared/slug"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadTargetConfig(
  root: string,
  alias: string,
  name: string
): { repo: string; defaults: Record<string, string> } | null {
  const configPath = join(root, ".dx", "config.json")
  if (!existsSync(configPath)) return null
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"))
    const entry = config?.targets?.[alias]
    if (!entry) return null
    const result: { repo: string; defaults: Record<string, string> } = {
      repo: entry.repo.replace(/\{name\}/g, name),
      defaults: {},
    }
    for (const [pkgType, tmpl] of Object.entries(entry.defaults ?? {})) {
      result.defaults[pkgType] = (tmpl as string).replace(/\{name\}/g, name)
    }
    return result
  } catch {
    return null
  }
}

function resolveLocalPackage(
  root: string,
  localPath: string
): { dir: string; type: "npm" | "java" | "python"; name: string } {
  // Try as direct path
  const candidate = join(root, localPath)
  if (existsSync(candidate)) {
    const pkgType = detectPkgType(candidate)
    if (!pkgType) {
      throw new Error(`Could not detect package type at ${localPath}`)
    }
    return { dir: candidate, type: pkgType, name: basename(candidate) }
  }

  // Try as short name in packages/{npm,java,python}/<name>
  const matches: {
    dir: string
    type: "npm" | "java" | "python"
    name: string
  }[] = []
  for (const typeDir of ["npm", "java", "python"] as const) {
    const c = join(root, "packages", typeDir, localPath)
    if (existsSync(c)) {
      const pt = detectPkgType(c)
      if (pt) matches.push({ dir: c, type: pt, name: localPath })
    }
  }

  // Also check flat packages/<name> layout
  if (matches.length === 0) {
    const flat = join(root, "packages", localPath)
    if (existsSync(flat)) {
      const pt = detectPkgType(flat)
      if (pt) matches.push({ dir: flat, type: pt, name: localPath })
    }
  }

  if (matches.length === 1) return matches[0]
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous package name '${localPath}', found in multiple type dirs.\nUse the full path instead (e.g., packages/npm/${localPath})`
    )
  }

  throw new Error(
    `Package '${localPath}' not found.\nProvide a full path (e.g., packages/npm/${localPath}) or a package name`
  )
}

/** Count files that would be copied (excluding ignored). */
function countFiles(dir: string, filter: (src: string) => boolean): number {
  let count = 0
  function walk(d: string) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (!filter(full)) continue
      if (entry.isDirectory()) walk(full)
      else count++
    }
  }
  walk(dir)
  return count
}

// ---------------------------------------------------------------------------
// Contribute command
// ---------------------------------------------------------------------------

export interface ContributeOptions {
  localPath: string
  target?: string
  to?: string
  path?: string
  as?: string
  ref?: string
  branch?: string
  dryRun?: boolean
  yes?: boolean
  verbose?: boolean
}

export async function pkgContribute(
  root: string,
  opts: ContributeOptions
): Promise<void> {
  // Resolve local package
  const pkg = resolveLocalPackage(root, opts.localPath)
  const name = opts.as ?? pkg.name

  // Resolve target repo and path
  let gitUrl: string | undefined
  let targetPath = opts.path

  if (opts.to) {
    const config = loadTargetConfig(root, opts.to, name)
    if (!config) {
      throw new Error(`Target alias '${opts.to}' not found in .dx/config.json`)
    }
    gitUrl = resolveSource(config.repo)
    if (!targetPath) targetPath = config.defaults[pkg.type]
  } else if (opts.target) {
    gitUrl = resolveSource(opts.target)
  } else {
    throw new Error(
      "Provide a target repo or use --to <alias>\n" +
        "  dx pkg contribute <pkg> <repo> [--path <dir>]\n" +
        "  dx pkg contribute <pkg> --to <alias>"
    )
  }

  // Check for duplicate
  const pm = new PackageState(root)
  const existing = pm.get(name)
  if (existing) {
    throw new Error(
      `Package '${name}' is already tracked (mode: ${existing.mode ?? "link"})\n` +
        "Run 'dx pkg unlink' first to untrack it"
    )
  }

  console.log(`Contributing ${name} to ${shortSource(gitUrl)}`)
  console.log(`  Package: ${relative(root, pkg.dir)}`)
  console.log(`  Target path: ${targetPath ?? "(repo root)"}`)

  const filter = buildCopyFilter(pkg.dir)
  const fileCount = countFiles(pkg.dir, filter)
  console.log(`  Files to copy: ${fileCount}`)

  if (opts.dryRun) {
    console.log("\n[dry-run] No changes made")
    return
  }

  // Clone target repo
  const tmpDir = mkdtempSync(join(tmpdir(), "dx-pkg-"))
  try {
    console.log(`Cloning ${shortSource(gitUrl)}...`)
    const cloneArgs = ["git", "clone", "--depth", "1", "--progress"]
    if (opts.ref) cloneArgs.push("--branch", opts.ref)
    cloneArgs.push(gitUrl, join(tmpDir, "repo"))

    await exec(cloneArgs)

    const cloned = join(tmpDir, "repo")

    // Move clone to .dx/pkg-repos/<name>/
    const reposDir = join(root, ".dx", "pkg-repos")
    mkdirSync(reposDir, { recursive: true })
    const repoDest = join(reposDir, name)
    if (existsSync(repoDest)) rmSync(repoDest, { recursive: true })
    renameSync(cloned, repoDest)

    // Detect base branch
    const branchResult = await capture(
      ["git", "rev-parse", "--abbrev-ref", "HEAD"],
      {
        cwd: repoDest,
      }
    )
    const defaultBranch =
      branchResult.exitCode === 0
        ? branchResult.stdout.trim()
        : (opts.ref ?? "main")

    // Create contribute branch
    const checkoutBranch =
      opts.branch ?? `dx/${name}-contribute-${generateBranchSlug()}`
    await exec(["git", "checkout", "-b", checkoutBranch], { cwd: repoDest })

    // Copy files into staging clone
    const destDir = targetPath ? join(repoDest, targetPath) : repoDest
    mkdirSync(destDir, { recursive: true })
    cpSync(pkg.dir, destDir, { recursive: true, filter })

    // Stage and commit
    await exec(["git", "add", "-A"], { cwd: repoDest })
    await exec(["git", "commit", "-m", `dx: add ${name} package`], {
      cwd: repoDest,
    })

    // Push
    console.log(`Pushing branch ${checkoutBranch}...`)
    await exec(["git", "push", "-u", "origin", checkoutBranch], {
      cwd: repoDest,
    })
    console.log("Pushed to remote")

    // Create PR via gh
    const ghCheck = await capture(["which", "gh"])
    if (ghCheck.exitCode === 0) {
      console.log("Creating pull request...")
      const prResult = await capture(
        [
          "gh",
          "pr",
          "create",
          "--title",
          `Add ${name} package`,
          "--body",
          `Contributes \`${name}\` package from project workspace via \`dx pkg contribute\`.`,
          "--base",
          defaultBranch,
          "--head",
          checkoutBranch,
        ],
        { cwd: repoDest }
      )
      if (prResult.exitCode === 0) {
        console.log(`Pull request created: ${prResult.stdout.trim()}`)
      } else if (
        (prResult.stdout + prResult.stderr)
          .toLowerCase()
          .includes("already exists")
      ) {
        console.log("PR already exists")
      } else {
        console.warn(
          `Could not create PR: ${prResult.stderr || prResult.stdout}`
        )
      }
    } else {
      console.log("gh CLI not found — create a PR manually:")
      console.log(`  Branch: ${checkoutBranch}`)
    }

    // Save state
    pm.add(name, {
      source: gitUrl,
      source_path: targetPath,
      type: pkg.type,
      local_path: relative(root, pkg.dir),
      branch: defaultBranch,
      checkout_branch: checkoutBranch,
      contributed_at: new Date().toISOString(),
      repo_path: relative(root, repoDest),
      mode: "contribute",
    })

    console.log(`Package ${name} is now tracked for contribution`)
    console.log(`  Push changes:  dx pkg push ${name}`)
    console.log(`  Pull upstream: dx pkg pull ${name}`)
    console.log(`  Stop tracking: dx pkg unlink ${name}`)
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// Sync helpers (used by push/pull for contribute-mode packages)
// ---------------------------------------------------------------------------

/**
 * Sync local files into the staging clone before a push.
 * Returns true if sync succeeded, false if aborted (divergence).
 */
export async function syncToStaging(
  root: string,
  entry: PackageEntry
): Promise<boolean> {
  if (!entry.repo_path) return false
  const repoDir = join(root, entry.repo_path)
  const localDir = join(root, entry.local_path)

  const branch =
    entry.checkout_branch ?? `dx/${basename(entry.local_path)}-contribute`
  await exec(["git", "checkout", branch], { cwd: repoDir })

  // Fetch upstream
  console.log("Fetching upstream changes...")
  await exec(["git", "fetch", "origin"], { cwd: repoDir })

  // Check for divergence
  const localRev = await capture(["git", "rev-parse", branch], { cwd: repoDir })
  const remoteRev = await capture(["git", "rev-parse", `origin/${branch}`], {
    cwd: repoDir,
  })
  if (
    localRev.exitCode === 0 &&
    remoteRev.exitCode === 0 &&
    localRev.stdout.trim() !== remoteRev.stdout.trim()
  ) {
    const mergeBase = await capture(
      ["git", "merge-base", branch, `origin/${branch}`],
      { cwd: repoDir }
    )
    if (mergeBase.exitCode === 0) {
      if (mergeBase.stdout.trim() === localRev.stdout.trim()) {
        console.warn(
          "Upstream has new commits on the contribute branch.\n" +
            "Run 'dx pkg pull <name>' first to incorporate upstream changes."
        )
        return false
      }
      if (mergeBase.stdout.trim() !== remoteRev.stdout.trim()) {
        console.warn(
          "Local and upstream branches have diverged.\n" +
            "Run 'dx pkg pull <name>' to reconcile before pushing."
        )
        return false
      }
    }
  }

  // Clear and re-copy files into staging target
  const targetDir = entry.source_path
    ? join(repoDir, entry.source_path)
    : repoDir
  const filter = buildCopyFilter(localDir)

  if (entry.source_path) {
    if (existsSync(targetDir)) rmSync(targetDir, { recursive: true })
    mkdirSync(targetDir, { recursive: true })
    cpSync(localDir, targetDir, { recursive: true, filter })
  } else {
    // Root-targeted: only replace files from local package
    cpSync(localDir, targetDir, { recursive: true, filter })
  }

  return true
}

/**
 * Pull upstream changes from the staging clone back to local files.
 */
export async function syncFromStaging(
  root: string,
  entry: PackageEntry,
  dryRun?: boolean
): Promise<void> {
  if (!entry.repo_path) return
  const repoDir = join(root, entry.repo_path)
  const localDir = join(root, entry.local_path)
  const baseBranch = entry.branch ?? "main"

  const contributeBranch =
    entry.checkout_branch ?? `dx/${basename(entry.local_path)}-contribute`
  await exec(["git", "checkout", contributeBranch], { cwd: repoDir })

  // Fetch and merge upstream base into contribute branch
  console.log("Fetching upstream changes...")
  await exec(["git", "fetch", "origin"], { cwd: repoDir })

  const mergeResult = await capture(
    ["git", "merge", `origin/${baseBranch}`, "--no-edit"],
    { cwd: repoDir }
  )
  if (mergeResult.exitCode !== 0) {
    await exec(["git", "merge", "--abort"], { cwd: repoDir })
    throw new Error(
      `Merge failed — upstream base branch has conflicting changes:\n${mergeResult.stderr || mergeResult.stdout}`
    )
  }

  const srcDir = entry.source_path ? join(repoDir, entry.source_path) : repoDir

  if (!existsSync(srcDir)) {
    console.warn("Upstream path does not exist — nothing to pull")
    return
  }

  // For simplicity, copy from staging to local
  const filter = buildCopyFilter(srcDir)

  if (dryRun) {
    console.log("[dry-run] Would sync from staging to local")
    return
  }

  cpSync(srcDir, localDir, { recursive: true, filter })
  console.log("Pulled upstream changes")
}
