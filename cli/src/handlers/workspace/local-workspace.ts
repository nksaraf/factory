/**
 * Local workspace backend — worktree tier.
 *
 * Implements create/list/show/delete for git worktree-based workspaces.
 * Used by `dx workspace` when --tier=worktree.
 */

import { basename, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { findComposeRoot, type ComposeDiscoveryOptions } from "@smp/factory-shared/config-loader";
import { defaultConventionsConfig } from "@smp/factory-shared/conventions-schema";
import { loadConventions, validateBranchName } from "@smp/factory-shared/conventions";
import { DockerComposeFormatAdapter } from "@smp/factory-shared/formats/docker-compose.adapter";

import {
  PortManager,
  catalogToPortRequests,
  portEnvVars,
} from "../../lib/port-manager.js";
import { installHooks } from "../../lib/hooks.js";
import { detectToolchain } from "../../lib/toolchain-detector.js";
import { composeDown } from "../../lib/docker.js";
import { hasUncommittedChanges } from "../../lib/git.js";
import {
  type LocalWorkspaceInfo,
  type WorkspacePaths,
  discoverAllLocalWorkspaces,
  discoverLocalWorkspaces,
  resolveWorkspacePaths,
} from "../../lib/worktree-detect.js";
import { discoverComposeFiles } from "@smp/factory-shared/config-loader";
import { loadDxProjectConfigOrDefaults } from "../../lib/dx-project-config.js";

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateLocalWorkspaceOpts {
  name: string;
  branch: string;
  path?: string;
  skipInstall?: boolean;
  force?: boolean;
}

export async function createLocalWorkspace(
  opts: CreateLocalWorkspaceOpts,
): Promise<LocalWorkspaceInfo> {
  const paths = await resolveWorkspacePaths();

  // Validate branch name against conventions
  if (!opts.force) {
    const root = findComposeRoot(process.cwd());
    const conventions = root
      ? loadConventions(root)
      : defaultConventionsConfig();
    const result = validateBranchName(opts.branch, conventions);
    if (!result.valid) {
      throw new Error(
        `Convention violation:\n${result.violations.join("\n")}\n\nSuggestions:\n${result.suggestions.join("\n")}\n\nUse --force to skip validation.`,
      );
    }
  }

  // Compute the worktree path
  const worktreePath =
    opts.path ?? join(paths.projectWorktreesDir, opts.name);

  // Create the worktree
  const gitArgs = ["worktree", "add", worktreePath, "-b", opts.branch];
  const proc = spawnSync("git", gitArgs, {
    cwd: paths.projectRepoDir,
    stdio: "inherit",
  });
  if (proc.status !== 0) {
    // Try without -b in case branch already exists
    const retryProc = spawnSync(
      "git",
      ["worktree", "add", worktreePath, opts.branch],
      { cwd: paths.projectRepoDir, stdio: "inherit" },
    );
    if (retryProc.status !== 0) {
      throw new Error(`git worktree add failed (exit code ${retryProc.status})`);
    }
  }

  // Run setup in the new worktree
  const setupResult = await setupWorktree(worktreePath, opts);

  // Write worktree metadata
  const dxDir = join(worktreePath, ".dx");
  mkdirSync(dxDir, { recursive: true });
  const meta = {
    name: opts.name,
    mainRepoDir: paths.projectRepoDir,
    branch: opts.branch,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(
    join(dxDir, "worktree.json"),
    JSON.stringify(meta, null, 2) + "\n",
  );

  return {
    name: opts.name,
    tier: "worktree",
    path: worktreePath,
    branch: opts.branch,
    commit: "",
    ports: setupResult.ports,
    composeProject: basename(worktreePath),
    createdAt: meta.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Setup (reusable by dx work start later)
// ---------------------------------------------------------------------------

async function setupWorktree(
  worktreePath: string,
  opts: { skipInstall?: boolean },
): Promise<{ ports: Record<string, number> }> {
  const ports: Record<string, number> = {};

  // 1. Install dependencies
  if (!opts.skipInstall) {
    const toolchain = detectToolchain(worktreePath);
    const installCmd = resolveInstallCommand(toolchain, worktreePath);
    if (installCmd) {
      console.log(`Installing dependencies: ${installCmd.join(" ")}`);
      const proc = spawnSync(installCmd[0], installCmd.slice(1), {
        cwd: worktreePath,
        stdio: "inherit",
      });
      if (proc.status !== 0) {
        console.warn("Warning: dependency install failed, continuing setup...");
      }
    }
  }

  // 2. Install git hooks
  try {
    installHooks(worktreePath);
  } catch {
    // Non-fatal — hooks are nice to have
  }

  // 3. Allocate ports if docker-compose exists
  const composeRoot = findComposeRoot(worktreePath);
  if (composeRoot) {
    try {
      const adapter = new DockerComposeFormatAdapter();
      const { system: catalog } = adapter.parse(composeRoot);
      const portManager = new PortManager(join(worktreePath, ".dx"));
      const portRequests = catalogToPortRequests(catalog);
      const resolved = await portManager.resolveMulti(portRequests);

      // Build env vars and write ports.env
      const allEnvVars: Record<string, string> = {};
      for (const [service, servicePorts] of Object.entries(resolved)) {
        Object.assign(allEnvVars, portEnvVars(service, servicePorts));
        for (const [portName, port] of Object.entries(servicePorts)) {
          ports[`${service}/${portName}`] = port;
        }
      }
      const envPath = join(worktreePath, ".dx", "ports.env");
      portManager.writeEnvFile(allEnvVars, envPath);
    } catch (err) {
      console.warn(
        `Warning: port allocation failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  return { ports };
}

function resolveInstallCommand(
  toolchain: { packageManager?: string | null },
  dir: string,
): string[] | null {
  const pm = toolchain.packageManager;
  if (pm === "pnpm") return ["pnpm", "install"];
  if (pm === "npm") return ["npm", "install"];
  if (pm === "yarn") return ["yarn", "install"];
  if (pm === "bun") return ["bun", "install"];

  // Auto-detect from lock files
  if (existsSync(join(dir, "pnpm-lock.yaml"))) return ["pnpm", "install"];
  if (existsSync(join(dir, "yarn.lock"))) return ["yarn", "install"];
  if (existsSync(join(dir, "bun.lockb"))) return ["bun", "install"];
  if (existsSync(join(dir, "package-lock.json"))) return ["npm", "install"];
  if (existsSync(join(dir, "package.json"))) return ["npm", "install"];

  // Python
  if (existsSync(join(dir, "pyproject.toml"))) return ["pip", "install", "-e", "."];

  // Java
  if (existsSync(join(dir, "pom.xml"))) return ["mvn", "install", "-DskipTests"];

  return null;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listLocalWorkspaces(opts?: {
  project?: string;
}): Promise<LocalWorkspaceInfo[]> {
  const paths = await resolveWorkspacePaths();

  // If a specific project was requested, scope to that project
  if (opts?.project) {
    const scoped: WorkspacePaths = {
      ...paths,
      projectName: opts.project,
      projectRepoDir: join(paths.reposDir, opts.project),
      projectWorktreesDir: join(paths.worktreesDir, opts.project),
    };
    return discoverLocalWorkspaces(scoped);
  }

  // Default: scan all projects across the machine
  return discoverAllLocalWorkspaces(paths.reposDir, paths.worktreesDir);
}

// ---------------------------------------------------------------------------
// Show
// ---------------------------------------------------------------------------

export async function showLocalWorkspace(
  nameOrPath: string,
): Promise<LocalWorkspaceInfo | null> {
  const workspaces = await listLocalWorkspaces();
  const matches = workspaces.filter(
    (w) => w.name === nameOrPath || w.path === nameOrPath,
  );

  if (matches.length === 0) return null;

  if (matches.length > 1) {
    const paths = matches.map((w) => `  ${w.path}`).join("\n");
    throw new Error(
      `Ambiguous workspace name "${nameOrPath}" — found in multiple projects:\n${paths}\nUse the full path to disambiguate.`,
    );
  }

  return matches[0];
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export interface DeleteLocalWorkspaceOpts {
  force?: boolean;
}

export async function deleteLocalWorkspace(
  nameOrPath: string,
  opts: DeleteLocalWorkspaceOpts & { resolved?: LocalWorkspaceInfo } = {},
): Promise<void> {
  const workspace = opts.resolved ?? (await showLocalWorkspace(nameOrPath));
  if (!workspace) {
    throw new Error(`Local workspace "${nameOrPath}" not found.`);
  }

  // Safety check for uncommitted changes
  if (!opts.force && hasUncommittedChanges(workspace.path)) {
    throw new Error(
      `Workspace "${workspace.name}" has uncommitted changes. Use --force to delete anyway.`,
    );
  }

  // Stop compose project if running
  try {
    const dxConfig = loadDxProjectConfigOrDefaults(workspace.path);
    const composeOpts: ComposeDiscoveryOptions = {
      environment: process.env.DX_ENVIRONMENT ?? "local",
    };
    if (Array.isArray(dxConfig.raw.compose) && dxConfig.raw.compose.length > 0) {
      composeOpts.explicitFiles = dxConfig.raw.compose;
    }
    const composeRoot = findComposeRoot(workspace.path, composeOpts);
    if (composeRoot) {
      const composeFiles = discoverComposeFiles(composeRoot, composeOpts);
      console.log(`Stopping compose project "${workspace.composeProject}"...`);
      composeDown(composeFiles, {
        projectName: workspace.composeProject,
        volumes: true,
      });
    }
  } catch {
    // Non-fatal — compose might not be running
  }

  // Remove the git worktree (must run from inside the same git repo)
  const paths = await resolveWorkspacePaths(workspace.path);
  const gitArgs = ["worktree", "remove", workspace.path];
  if (opts.force) gitArgs.push("--force");

  const proc = spawnSync("git", gitArgs, {
    cwd: paths.projectRepoDir,
    stdio: "inherit",
  });
  if (proc.status !== 0) {
    throw new Error(`git worktree remove failed (exit code ${proc.status})`);
  }
}
