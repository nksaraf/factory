/**
 * Git worktree detection, discovery, and workbench path resolution.
 *
 * Supports three scenarios:
 * 1. Detecting if the current directory is inside a git worktree
 * 2. Discovering all existing worktrees for a project (including Conductor-created ones)
 * 3. Resolving the Conductor workbench layout (repos dir + worktrees dir)
 */
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"

import { readConfig } from "../config.js"
import {
  getCurrentBranch,
  getGitCommonDir,
  getGitDir,
  getShortSha,
} from "./git.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorktreeInfo {
  /** Basename of the worktree directory (e.g., "colombo"). */
  worktreeName: string
  /** Absolute path to this worktree's working directory. */
  worktreeDir: string
  /** Absolute path to the main repo checkout (where .git/ directory lives). */
  mainRepoDir: string
  /** The shared .git directory path. */
  gitCommonDir: string
  /** Current branch name. */
  branch: string
}

export interface WorktreeEntry {
  path: string
  head: string
  branch: string
}

export interface WorkbenchPaths {
  /** Base directory for main repo checkouts (e.g., ~/conductor/repos). */
  reposDir: string
  /** Base directory for worktree workbenches (e.g., ~/conductor/workspaces). */
  worktreesDir: string
  /** Project name derived from the repo directory (e.g., "factory"). */
  projectName: string
  /** Full path to the main repo (e.g., ~/conductor/repos/factory). */
  projectRepoDir: string
  /** Full path to the project's worktrees directory (e.g., ~/conductor/workspaces/factory). */
  projectWorktreesDir: string
}

export interface LocalWorkbenchInfo {
  name: string
  tier: "worktree"
  path: string
  branch: string
  commit: string
  ports: Record<string, number>
  composeProject: string
  createdAt?: string
}

// ---------------------------------------------------------------------------
// Worktree detection
// ---------------------------------------------------------------------------

/**
 * Check if the given directory is inside a git worktree (not the main checkout).
 */
export function isWorktree(cwd?: string): boolean {
  try {
    const dir = cwd ?? process.cwd()
    const gitDir = resolve(dir, getGitDir(dir))
    const commonDir = resolve(dir, getGitCommonDir(dir))
    return gitDir !== commonDir
  } catch {
    return false
  }
}

/**
 * Get detailed worktree info for the current directory.
 * Returns null if not in a worktree.
 */
export function getWorktreeInfo(cwd?: string): WorktreeInfo | null {
  try {
    const dir = cwd ?? process.cwd()
    const gitDir = resolve(dir, getGitDir(dir))
    const commonDir = resolve(dir, getGitCommonDir(dir))

    if (gitDir === commonDir) return null

    // The main repo is the parent of the .git directory
    const mainRepoDir = dirname(commonDir)
    const branch = getCurrentBranch(dir)

    return {
      worktreeName: basename(dir),
      worktreeDir: dir,
      mainRepoDir,
      gitCommonDir: commonDir,
      branch,
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Worktree listing (git porcelain)
// ---------------------------------------------------------------------------

/**
 * Parse `git worktree list --porcelain` output into structured entries.
 */
export function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  const blocks = output.trim().split("\n\n")
  for (const block of blocks) {
    if (!block.trim()) continue
    const lines = block.trim().split("\n")
    let path = ""
    let head = ""
    let branch = ""
    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        path = line.slice("worktree ".length)
      } else if (line.startsWith("HEAD ")) {
        head = line.slice("HEAD ".length)
      } else if (line.startsWith("branch refs/heads/")) {
        branch = line.slice("branch refs/heads/".length)
      } else if (line.startsWith("branch ")) {
        branch = line.slice("branch ".length)
      }
    }
    if (path) {
      entries.push({ path, head, branch })
    }
  }
  return entries
}

/**
 * List all worktrees for the repo that contains `cwd`.
 * Works from either the main checkout or any worktree.
 */
export function listAllWorktrees(cwd?: string): WorktreeEntry[] {
  const dir = cwd ?? process.cwd()
  const proc = spawnSync("git", ["worktree", "list", "--porcelain"], {
    cwd: dir,
    encoding: "utf8",
  })
  if (proc.status !== 0) return []
  return parseWorktreeList(proc.stdout || "")
}

// ---------------------------------------------------------------------------
// Workbench path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the Conductor workbench layout paths.
 *
 * Resolution order:
 * 1. Config values (workbenchReposDir / workbenchWorktreesDir) if set
 * 2. Env vars (DX_REPOS_DIR / DX_WORKTREES_DIR) if set
 * 3. Auto-detect from current git layout (Conductor convention)
 * 4. Default: ~/conductor/repos / ~/conductor/workspaces
 */
export async function resolveWorkbenchPaths(
  cwd?: string
): Promise<WorkbenchPaths> {
  const dir = cwd ?? process.cwd()
  const config = await readConfig()

  // Start with defaults
  const home = homedir()
  let reposDir = join(home, "conductor", "repos")
  let worktreesDir = join(home, "conductor", "workspaces")
  let projectName = ""

  // Try auto-detection from the Conductor layout.
  // Conductor layout: conductor/workspaces/<project>/<name>/
  // or: conductor/repos/<project>/
  const detected = detectConductorLayout(dir)
  if (detected) {
    reposDir = detected.reposDir
    worktreesDir = detected.worktreesDir
    projectName = detected.projectName
  }

  // Env vars override auto-detection
  if (process.env.DX_REPOS_DIR) reposDir = process.env.DX_REPOS_DIR
  if (process.env.DX_WORKTREES_DIR) worktreesDir = process.env.DX_WORKTREES_DIR

  // Config overrides everything
  if (config.workbenchReposDir) reposDir = config.workbenchReposDir
  if (config.workbenchWorktreesDir) worktreesDir = config.workbenchWorktreesDir

  // If we still don't have a project name, try to derive it from the git repo
  if (!projectName) {
    projectName = deriveProjectName(dir)
  }

  return {
    reposDir,
    worktreesDir,
    projectName,
    projectRepoDir: join(reposDir, projectName),
    projectWorktreesDir: join(worktreesDir, projectName),
  }
}

/**
 * Detect Conductor's directory layout from the current path.
 *
 * Looks for patterns like:
 *   .../conductor/workspaces/<project>/<name>/
 *   .../conductor/repos/<project>/
 */
function detectConductorLayout(
  dir: string
): { reposDir: string; worktreesDir: string; projectName: string } | null {
  // Walk up looking for the "workspaces" or "repos" marker
  const parts = dir.split("/")

  for (let i = parts.length - 1; i >= 2; i--) {
    if (parts[i - 1] === "workspaces" && i >= 2) {
      // dir is inside: <root>/workspaces/<project>/<name>/...
      // parts[i] is the project name, parts[i-1] is "workspaces"
      const root = parts.slice(0, i - 1).join("/")
      const projectName = parts[i]

      // Verify: check if a "repos" sibling exists
      const candidateRepos = join(root, "repos")
      if (existsSync(candidateRepos)) {
        return {
          reposDir: candidateRepos,
          worktreesDir: join(root, "workspaces"),
          projectName,
        }
      }
    }

    if (parts[i - 1] === "repos" && i >= 1) {
      // dir is inside: <root>/repos/<project>/...
      const root = parts.slice(0, i - 1).join("/")
      const projectName = parts[i]
      const candidateWorkspaces = join(root, "workspaces")
      if (existsSync(candidateWorkspaces)) {
        return {
          reposDir: join(root, "repos"),
          worktreesDir: candidateWorkspaces,
          projectName,
        }
      }
    }
  }

  return null
}

/**
 * Derive the project name from the git repo directory.
 * Uses the main repo dir (following worktree pointers) or the current dir.
 */
function deriveProjectName(dir: string): string {
  try {
    const commonDir = resolve(dir, getGitCommonDir(dir))
    // commonDir is the .git directory; its parent is the repo root
    return basename(dirname(commonDir))
  } catch {
    return basename(dir)
  }
}

// ---------------------------------------------------------------------------
// Discovery of existing Conductor workbenches
// ---------------------------------------------------------------------------

/**
 * Discover worktree-based workbenches across ALL projects in the Conductor layout.
 *
 * Scans every project directory under reposDir, running `git worktree list`
 * for each. This is used when `dx workbench list` is run outside any specific project.
 */
export function discoverAllLocalWorkbenches(
  reposDir: string,
  worktreesDir: string
): LocalWorkbenchInfo[] {
  const all: LocalWorkbenchInfo[] = []
  const discoveredProjects = new Set<string>()

  // 1. Scan repos dir for project directories
  if (existsSync(reposDir)) {
    try {
      const dirs = readdirSync(reposDir, { withFileTypes: true })
      for (const d of dirs) {
        if (!d.isDirectory()) continue
        const projectRepoDir = join(reposDir, d.name)
        // Check it's a git repo
        if (!existsSync(join(projectRepoDir, ".git"))) continue

        discoveredProjects.add(d.name)
        const paths: WorkbenchPaths = {
          reposDir,
          worktreesDir,
          projectName: d.name,
          projectRepoDir,
          projectWorktreesDir: join(worktreesDir, d.name),
        }
        all.push(...discoverLocalWorkbenches(paths))
      }
    } catch {
      // directory not readable, skip
    }
  }

  // 2. Scan worktrees dir for projects not already found in repos dir.
  //    This covers worktrees whose main repo lives outside the Conductor layout
  //    (e.g., ~/garage/org/project instead of ~/conductor/repos/project).
  if (existsSync(worktreesDir)) {
    try {
      const dirs = readdirSync(worktreesDir, { withFileTypes: true })
      for (const d of dirs) {
        if (!d.isDirectory()) continue
        if (discoveredProjects.has(d.name)) continue

        const projectWorktreesDir = join(worktreesDir, d.name)
        // Find a worktree inside to derive the main repo path
        const mainRepo = deriveMainRepoFromWorktrees(projectWorktreesDir)
        if (!mainRepo) continue

        discoveredProjects.add(d.name)
        const paths: WorkbenchPaths = {
          reposDir,
          worktreesDir,
          projectName: d.name,
          projectRepoDir: mainRepo,
          projectWorktreesDir,
        }
        all.push(...discoverLocalWorkbenches(paths))
      }
    } catch {
      // directory not readable, skip
    }
  }

  return all
}

/**
 * Derive the main repo path by reading a worktree's `.git` file.
 * Worktree `.git` files contain: `gitdir: /path/to/main/.git/worktrees/<name>`
 * Returns the main repo path, or null if none found.
 */
function deriveMainRepoFromWorktrees(worktreesDir: string): string | null {
  try {
    const entries = readdirSync(worktreesDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const gitFile = join(worktreesDir, entry.name, ".git")
      if (!existsSync(gitFile)) continue
      try {
        const content = readFileSync(gitFile, "utf8").trim()
        const match = content.match(/^gitdir:\s+(.+)$/)
        if (match) {
          // gitdir points to: <mainRepo>/.git/worktrees/<name>
          const gitdir = match[1]
          const worktreesIdx = gitdir.lastIndexOf("/.git/worktrees/")
          if (worktreesIdx !== -1) {
            return gitdir.slice(0, worktreesIdx)
          }
        }
      } catch {
        continue
      }
    }
  } catch {
    // not readable
  }
  return null
}

/**
 * Discover all existing worktree-based workbenches for a project.
 *
 * Uses `git worktree list` from the main repo to find all worktrees,
 * then enriches each with metadata from `.dx/` if available.
 * Works for worktrees created by Conductor, by `dx workbench create`, or manually.
 */
export function discoverLocalWorkbenches(
  paths: WorkbenchPaths
): LocalWorkbenchInfo[] {
  const { projectRepoDir, projectWorktreesDir } = paths

  // Run git worktree list from the main repo if it exists
  let entries: WorktreeEntry[] = []
  if (existsSync(projectRepoDir)) {
    entries = listAllWorktrees(projectRepoDir)
  }

  // If the main repo didn't exist, there's nothing to discover for this project
  if (entries.length === 0) {
    return []
  }

  const workbenches: LocalWorkbenchInfo[] = []

  for (const entry of entries) {
    // Skip the main checkout itself — it's not a workbench
    if (entry.path === projectRepoDir) continue

    const worktreeMeta = readWorktreeJson(entry.path)
    const ports = readPortsJson(entry.path)

    workbenches.push({
      name: worktreeMeta?.name ?? basename(entry.path),
      tier: "worktree",
      path: entry.path,
      branch: entry.branch || "(detached)",
      commit: entry.head.slice(0, 8),
      ports,
      composeProject: basename(entry.path),
      createdAt: worktreeMeta?.createdAt,
    })
  }

  // Also scan the worktrees directory for any that git might not know about
  // (e.g., orphaned worktree dirs)
  if (existsSync(projectWorktreesDir)) {
    try {
      const dirs = readdirSync(projectWorktreesDir, { withFileTypes: true })
      for (const d of dirs) {
        if (!d.isDirectory()) continue
        const dirPath = join(projectWorktreesDir, d.name)
        // Skip if already found via git worktree list
        if (workbenches.some((w) => w.path === dirPath)) continue
        // Skip symlinks
        if (d.isSymbolicLink()) continue
        // Check if it looks like a git worktree (has a .git file)
        const gitFile = join(dirPath, ".git")
        if (!existsSync(gitFile)) continue

        const worktreeMeta = readWorktreeJson(dirPath)
        const ports = readPortsJson(dirPath)
        let branch = ""
        let commit = ""
        try {
          branch = getCurrentBranch(dirPath)
          commit = getShortSha(dirPath)
        } catch {
          branch = "(unknown)"
        }

        workbenches.push({
          name: worktreeMeta?.name ?? d.name,
          tier: "worktree",
          path: dirPath,
          branch,
          commit,
          ports,
          composeProject: d.name,
          createdAt: worktreeMeta?.createdAt,
        })
      }
    } catch {
      // directory not readable, skip
    }
  }

  return workbenches
}

// ---------------------------------------------------------------------------
// Metadata readers
// ---------------------------------------------------------------------------

interface WorktreeJson {
  name: string
  mainRepoDir?: string
  branch?: string
  createdAt?: string
}

function readWorktreeJson(worktreeDir: string): WorktreeJson | null {
  const p = join(worktreeDir, ".dx", "worktree.json")
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, "utf8"))
  } catch {
    return null
  }
}

function readPortsJson(worktreeDir: string): Record<string, number> {
  const p = join(worktreeDir, ".dx", "ports.json")
  if (!existsSync(p)) return {}
  try {
    const data = JSON.parse(readFileSync(p, "utf8"))
    // ports.json has shape: { "service/port": { port: N, pinned: bool } }
    const flat: Record<string, number> = {}
    for (const [key, val] of Object.entries(data)) {
      if (val && typeof val === "object" && "port" in val) {
        flat[key] = (val as { port: number }).port
      }
    }
    return flat
  } catch {
    return {}
  }
}
