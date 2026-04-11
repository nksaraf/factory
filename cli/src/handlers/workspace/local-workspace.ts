/**
 * Local workbench backend — worktree tier.
 *
 * Implements create/list/show/delete for git worktree-based workbenches.
 * Used by `dx workbench` when --tier=worktree.
 */
import {
  type ComposeDiscoveryOptions,
  findComposeRoot,
} from "@smp/factory-shared/config-loader"
import { discoverComposeFiles } from "@smp/factory-shared/config-loader"
import {
  loadConventions,
  validateBranchName,
} from "@smp/factory-shared/conventions"
import { defaultConventionsConfig } from "@smp/factory-shared/conventions-schema"
import { DockerComposeFormatAdapter } from "@smp/factory-shared/formats/docker-compose.adapter"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"

import { Compose } from "../../lib/docker.js"
import { loadDxProjectConfigOrDefaults } from "../../lib/dx-project-config.js"
import { hasUncommittedChanges } from "../../lib/git.js"
import { installHooks } from "../../lib/hooks.js"
import {
  PortManager,
  catalogToPortRequests,
  portEnvVars,
} from "../../lib/port-manager.js"
import { detectToolchain } from "../../lib/toolchain-detector.js"
import {
  type LocalWorkbenchInfo,
  type WorkspacePaths,
  discoverAllLocalWorkspaces,
  discoverLocalWorkspaces,
  resolveWorkspacePaths,
} from "../../lib/worktree-detect.js"

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateLocalWorkbenchOpts {
  name: string
  branch: string
  path?: string
  skipInstall?: boolean
  force?: boolean
}

export async function createLocalWorkbench(
  opts: CreateLocalWorkbenchOpts
): Promise<LocalWorkbenchInfo> {
  const paths = await resolveWorkspacePaths()

  // Validate branch name against conventions
  if (!opts.force) {
    const root = findComposeRoot(process.cwd())
    const conventions = root
      ? loadConventions(root)
      : defaultConventionsConfig()
    const result = validateBranchName(opts.branch, conventions)
    if (!result.valid) {
      throw new Error(
        `Convention violation:\n${result.violations.join("\n")}\n\nSuggestions:\n${result.suggestions.join("\n")}\n\nUse --force to skip validation.`
      )
    }
  }

  // Compute the worktree path
  const worktreePath = opts.path ?? join(paths.projectWorktreesDir, opts.name)

  // Create the worktree
  const gitArgs = ["worktree", "add", worktreePath, "-b", opts.branch]
  const proc = spawnSync("git", gitArgs, {
    cwd: paths.projectRepoDir,
    stdio: "inherit",
  })
  if (proc.status !== 0) {
    // Try without -b in case branch already exists
    const retryProc = spawnSync(
      "git",
      ["worktree", "add", worktreePath, opts.branch],
      { cwd: paths.projectRepoDir, stdio: "inherit" }
    )
    if (retryProc.status !== 0) {
      throw new Error(`git worktree add failed (exit code ${retryProc.status})`)
    }
  }

  // Run setup in the new worktree
  const setupResult = await setupWorktree(worktreePath, opts)

  // Write worktree metadata
  const dxDir = join(worktreePath, ".dx")
  mkdirSync(dxDir, { recursive: true })
  const meta = {
    name: opts.name,
    mainRepoDir: paths.projectRepoDir,
    branch: opts.branch,
    createdAt: new Date().toISOString(),
  }
  writeFileSync(
    join(dxDir, "worktree.json"),
    JSON.stringify(meta, null, 2) + "\n"
  )

  // Register in Conductor DB (best-effort)
  try {
    const { registerWorkbenchInConductorDb } =
      await import("../../lib/conductor-db.js")
    registerWorkbenchInConductorDb({
      name: opts.name,
      branch: opts.branch,
      worktreePath,
      repoDir: paths.projectRepoDir,
    })
  } catch {
    // Non-fatal: Conductor DB registration is optional
  }

  return {
    name: opts.name,
    tier: "worktree",
    path: worktreePath,
    branch: opts.branch,
    commit: "",
    ports: setupResult.ports,
    composeProject: basename(worktreePath),
    createdAt: meta.createdAt,
  } as LocalWorkbenchInfo
}

// ---------------------------------------------------------------------------
// Setup (reusable by dx work start later)
// ---------------------------------------------------------------------------

async function setupWorktree(
  worktreePath: string,
  opts: { skipInstall?: boolean }
): Promise<{ ports: Record<string, number> }> {
  const ports: Record<string, number> = {}

  // 1. Install dependencies
  if (!opts.skipInstall) {
    const toolchain = detectToolchain(worktreePath)
    const installCmd = resolveInstallCommand(toolchain, worktreePath)
    if (installCmd) {
      console.log(`Installing dependencies: ${installCmd.join(" ")}`)
      const proc = spawnSync(installCmd[0], installCmd.slice(1), {
        cwd: worktreePath,
        stdio: "inherit",
      })
      if (proc.status !== 0) {
        console.warn("Warning: dependency install failed, continuing setup...")
      }
    }
  }

  // 2. Install git hooks
  try {
    installHooks(worktreePath)
  } catch {
    // Non-fatal — hooks are nice to have
  }

  // 3. Allocate ports if docker-compose exists
  const composeRoot = findComposeRoot(worktreePath)
  if (composeRoot) {
    try {
      const adapter = new DockerComposeFormatAdapter()
      const { system: catalog } = adapter.parse(composeRoot)
      const portManager = new PortManager(join(worktreePath, ".dx"))
      const portRequests = catalogToPortRequests(catalog)
      const resolved = await portManager.resolveMulti(portRequests)

      // Build env vars and write ports.env
      const allEnvVars: Record<string, string> = {}
      for (const [service, servicePorts] of Object.entries(resolved)) {
        Object.assign(allEnvVars, portEnvVars(service, servicePorts))
        for (const [portName, port] of Object.entries(servicePorts)) {
          ports[`${service}/${portName}`] = port
        }
      }
      const envPath = join(worktreePath, ".dx", "ports.env")
      portManager.writeEnvFile(allEnvVars, envPath)
    } catch (err) {
      console.warn(
        `Warning: port allocation failed: ${err instanceof Error ? err.message : err}`
      )
    }
  }

  return { ports }
}

function resolveInstallCommand(
  toolchain: { packageManager?: string | null },
  dir: string
): string[] | null {
  const pm = toolchain.packageManager
  if (pm === "pnpm") return ["pnpm", "install"]
  if (pm === "npm") return ["npm", "install"]
  if (pm === "yarn") return ["yarn", "install"]
  if (pm === "bun") return ["bun", "install"]

  // Auto-detect from lock files
  if (existsSync(join(dir, "pnpm-lock.yaml"))) return ["pnpm", "install"]
  if (existsSync(join(dir, "yarn.lock"))) return ["yarn", "install"]
  if (existsSync(join(dir, "bun.lockb"))) return ["bun", "install"]
  if (existsSync(join(dir, "package-lock.json"))) return ["npm", "install"]
  if (existsSync(join(dir, "package.json"))) return ["npm", "install"]

  // Python
  if (existsSync(join(dir, "pyproject.toml")))
    return ["pip", "install", "-e", "."]

  // Java
  if (existsSync(join(dir, "pom.xml"))) return ["mvn", "install", "-DskipTests"]

  return null
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listLocalWorkbenches(opts?: {
  project?: string
}): Promise<LocalWorkbenchInfo[]> {
  const paths = await resolveWorkspacePaths()

  // If a specific project was requested, scope to that project
  if (opts?.project) {
    const scoped: WorkspacePaths = {
      ...paths,
      projectName: opts.project,
      projectRepoDir: join(paths.reposDir, opts.project),
      projectWorktreesDir: join(paths.worktreesDir, opts.project),
    }
    return discoverLocalWorkspaces(scoped)
  }

  // Default: scan all projects across the machine
  return discoverAllLocalWorkbenches(paths.reposDir, paths.worktreesDir)
}

// ---------------------------------------------------------------------------
// Show
// ---------------------------------------------------------------------------

export async function showLocalWorkbench(
  nameOrPath: string
): Promise<LocalWorkbenchInfo | null> {
  const workbenches = await listLocalWorkbenches()
  const matches = workbenches.filter(
    (w) => w.name === nameOrPath || w.path === nameOrPath
  )

  if (matches.length === 0) return null

  if (matches.length > 1) {
    const paths = matches.map((w) => `  ${w.path}`).join("\n")
    throw new Error(
      `Ambiguous workbench name "${nameOrPath}" — found in multiple projects:\n${paths}\nUse the full path to disambiguate.`
    )
  }

  return matches[0]
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export interface DeleteLocalWorkbenchOpts {
  force?: boolean
}

export async function deleteLocalWorkbench(
  nameOrPath: string,
  opts: DeleteLocalWorkbenchOpts & { resolved?: LocalWorkbenchInfo } = {}
): Promise<void> {
  const workbench = opts.resolved ?? (await showLocalWorkbench(nameOrPath))
  if (!workbench) {
    throw new Error(`Local workbench "${nameOrPath}" not found.`)
  }

  // Safety check for uncommitted changes
  if (!opts.force && hasUncommittedChanges(workbench.path)) {
    throw new Error(
      `Workbench "${workbench.name}" has uncommitted changes. Use --force to delete anyway.`
    )
  }

  // Stop compose project if running
  try {
    const dxConfig = loadDxProjectConfigOrDefaults(workbench.path)
    const composeOpts: ComposeDiscoveryOptions = {
      environment: process.env.DX_ENVIRONMENT ?? "local",
    }
    if (
      Array.isArray(dxConfig.raw.compose) &&
      dxConfig.raw.compose.length > 0
    ) {
      composeOpts.explicitFiles = dxConfig.raw.compose
    }
    const composeRoot = findComposeRoot(workbench.path, composeOpts)
    if (composeRoot) {
      const composeFiles = discoverComposeFiles(composeRoot, composeOpts)
      console.log(`Stopping compose project "${workbench.composeProject}"...`)
      new Compose(composeFiles, workbench.composeProject).down({
        volumes: true,
      })
    }
  } catch {
    // Non-fatal — compose might not be running
  }

  // Remove the git worktree (must run from inside the same git repo)
  const paths = await resolveWorkspacePaths(workbench.path)

  // Unregister from Conductor DB (best-effort)
  try {
    const { unregisterWorkbenchFromConductorDb } =
      await import("../../lib/conductor-db.js")
    unregisterWorkbenchFromConductorDb(workbench.name, paths.projectRepoDir)
  } catch {
    // Non-fatal
  }
  const gitArgs = ["worktree", "remove", workbench.path]
  if (opts.force) gitArgs.push("--force")

  const proc = spawnSync("git", gitArgs, {
    cwd: paths.projectRepoDir,
    stdio: "inherit",
  })
  if (proc.status !== 0) {
    throw new Error(`git worktree remove failed (exit code ${proc.status})`)
  }
}
