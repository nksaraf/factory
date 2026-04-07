/**
 * DX Context Architecture — layered context hierarchy.
 *
 * Four tiers, each with distinct scope and resolution:
 *
 *   Host      → "who am I, where do I keep things"
 *   Project   → "what am I building"
 *   Workspace → "where am I working" (worktree / container / VM)
 *   Package   → "which package am I in"
 *
 * Commands declare the tier they need via `resolveDxContext({ need: "project" })`.
 * Lower tiers imply higher ones: needing "workspace" implies "project" and "host".
 */

import type { CatalogSystem } from "@smp/factory-shared/catalog";
import type { ConventionsConfig } from "@smp/factory-shared/conventions-schema";
import {
  type DxConfig,
  type FactoryModeInfo,
  dxConfigStore,
  resolveFactoryMode,
} from "../config.js";
import type { DxProjectConfig } from "./dx-project-config.js";
import { detectToolchain, type DetectedToolchain } from "./toolchain-detector.js";
import { type MonorepoPackage, type PackageManifest, fromCwd as monorepoFromCwd } from "./workspace-context.js";
import { ProjectContext } from "./project.js";
import { findComposeRoot } from "@smp/factory-shared/config-loader";
import { getWorktreeInfo } from "./worktree-detect.js";
import { loadPackageScripts, loadPackageJson } from "./dx-project-config.js";
import { getCurrentBranch } from "./git.js";
import { PortManager } from "./port-manager.js";
import { basename, dirname, join, relative } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import {
  type SessionPayload,
  readSession,
  readSessionForProfile,
  resolveActiveProfile,
} from "../session-token.js";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Tier 1: Host — machine-wide, no cwd dependency
// ---------------------------------------------------------------------------

/** Conductor directory layout for repos and worktrees. */
export interface ConductorLayout {
  /** Base directory for main repo checkouts (e.g., ~/conductor/repos). */
  reposDir: string;
  /** Base directory for worktree workspaces (e.g., ~/conductor/workspaces). */
  worktreesDir: string;
}

/** Machine-wide context — always available, independent of cwd. */
export interface HostContext {
  /** Global dx config from ~/.config/dx/config.json. */
  config: DxConfig;
  /** Auth session for the active profile. */
  session: SessionPayload;
  /** Conductor directory layout (repos + worktrees base dirs). */
  layout: ConductorLayout;
  /** Resolved Factory connection info (URL, mode, env override). */
  factory: FactoryModeInfo;
}

// ---------------------------------------------------------------------------
// Tier 2: Project — what am I building
// ---------------------------------------------------------------------------

/** Project-level context — resolved from docker-compose root or package.json. */
export interface ProjectContextData {
  /** Project/system name. */
  name: string;
  /** Absolute path to project root (docker-compose root). */
  rootDir: string;
  /** Discovered compose file paths. */
  composeFiles: string[];
  /** Service catalog parsed from docker-compose labels. */
  catalog: CatalogSystem;
  /** Project conventions from .dxconventions.yaml. */
  conventions: ConventionsConfig;
  /** dx config from package.json#dx. */
  dxConfig: DxProjectConfig;
  /** All scripts from the root package.json. */
  scripts: Record<string, string>;
  /** Raw package.json contents. */
  packageJson: Record<string, unknown> | null;
  /** All packages discovered in the monorepo (npm, python, java, go, rust). */
  monorepoPackages: MonorepoPackage[];
  /** Project owner (from dxConfig.team or catalog spec). */
  owner: string;
  /** All unique Docker Compose profile names across components and resources. */
  allProfiles: string[];
}

// ---------------------------------------------------------------------------
// Tier 3: Workspace — where am I working
// ---------------------------------------------------------------------------

/** The isolation kind of a workspace. */
export type WorkspaceKind = "main" | "worktree" | "container" | "vm";

/** Workspace-level context — an isolation unit within a project. */
export interface WorkspaceContextData {
  /** Workspace name (e.g., "colombo", or project name for main checkout). */
  name: string;
  /** Absolute path to this workspace's working directory. */
  dir: string;
  /** Isolation tier. */
  kind: WorkspaceKind;
  /** Current git branch. */
  branch: string;
  /** Path to the main git checkout (same as dir for kind=main). */
  mainRepoDir: string;
  /** Docker compose project name (workspace name for worktrees, project name for main). */
  composeProjectName: string;
  /** Port allocations from .dx/ports.json. */
  ports: PortManager;
  /** Project-local .dx/config.json overrides (partial — only non-empty fields). */
  localConfig: Partial<DxConfig>;
  /** Resolved auth profile name from .dx/workbench.json. */
  authProfile: string;
}

// ---------------------------------------------------------------------------
// Tier 4: Package — which package am I in
// ---------------------------------------------------------------------------

/**
 * Package-level context — a buildable/runnable unit within a project.
 *
 * Language-agnostic: npm package, Python pyproject, Maven module,
 * Go module, Rust crate, Spring Boot app, Next.js app, etc.
 */
export interface PackageContextData {
  /** Package name. */
  name: string;
  /** Absolute path to package directory. */
  dir: string;
  /** Path relative to project root. */
  relativePath: string;
  /** Package ecosystem. */
  type: "npm" | "python" | "java" | "go" | "rust";
  /** Auto-detected toolchain (test, lint, format, typecheck, etc.). */
  toolchain: DetectedToolchain;
  /** Parsed manifest (package.json / pyproject.toml / pom.xml / go.mod / Cargo.toml). */
  manifest: PackageManifest;
  /** Runnable scripts for this package. */
  scripts: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Composed DxContext
// ---------------------------------------------------------------------------

/** The full, layered context available to any dx command. */
export interface DxContext {
  /** Always available — machine-wide config, auth, layout. */
  host: HostContext;
  /** Available when inside a project directory. Null outside any project. */
  project: ProjectContextData | null;
  /** Available when inside a workspace directory. Null outside any workspace. */
  workspace: WorkspaceContextData | null;
  /** Available when cwd is inside a specific package. Null at project root or outside packages. */
  package: PackageContextData | null;
}

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

/**
 * Get the effective config by merging workspace-local overrides into the global config.
 * Use this instead of `readConfig()` when you already have a DxContext — it avoids
 * a redundant walk-up and file read.
 */
export function effectiveConfig(ctx: DxContext): DxConfig {
  if (!ctx.workspace || Object.keys(ctx.workspace.localConfig).length === 0) {
    return ctx.host.config;
  }
  return { ...ctx.host.config, ...ctx.workspace.localConfig } as DxConfig;
}

// ---------------------------------------------------------------------------
// Context requirement types — commands declare what they need
// ---------------------------------------------------------------------------

/** Context with project guaranteed non-null. */
export interface DxContextWithProject extends DxContext {
  project: ProjectContextData;
}

/** Context with workspace guaranteed non-null. */
export interface DxContextWithWorkspace extends DxContext {
  project: ProjectContextData;
  workspace: WorkspaceContextData;
}

/** Context with package guaranteed non-null. */
export interface DxContextWithPackage extends DxContext {
  project: ProjectContextData;
  package: PackageContextData;
}

/** What context tier a command needs. */
export type ContextNeed = "host" | "project" | "workspace" | "package";

// ---------------------------------------------------------------------------
// Per-process context cache — avoids redundant file I/O when resolveDxContext
// is called multiple times with the same cwd (e.g., dx status resolves project
// context for both project info and compose status).
// ---------------------------------------------------------------------------
let _cachedCwd: string | null = null;
let _cachedCtx: DxContext | null = null;

/** Clear the context cache. Useful in tests or after config changes. */
export function clearDxContextCache(): void {
  _cachedCwd = null;
  _cachedCtx = null;
}

/**
 * Resolve the DxContext for the current working directory.
 *
 * Commands declare what they need:
 *   const ctx = await resolveDxContext({ need: "project" });
 *   // ctx.project is guaranteed non-null
 *
 * Resolution builds each tier lazily:
 *   host      — always resolved (reads ~/.config/dx/)
 *   project   — resolved if cwd is inside a project (docker-compose root)
 *   workspace — resolved if cwd is inside a git repo (worktree or main checkout)
 *   package   — resolved if cwd is inside a specific package directory
 *
 * Throws if the requested tier cannot be resolved (e.g., "project" but not inside one).
 *
 * **Toolchain command pattern:** Commands like `dx lint`, `dx format`, `dx typecheck`,
 * and `dx generate` use `{ need: "host" }` and manually check `ctx.package` instead of
 * `{ need: "package" }`. This is because `need: "package"` also requires a project
 * (docker-compose), but these commands must work in standalone packages outside of
 * docker-compose projects. The `{ need: "host" }` + null-check pattern allows the
 * standalone package resolver to kick in.
 */
export async function resolveDxContext(opts: { need: "host"; cwd?: string }): Promise<DxContext>;
export async function resolveDxContext(opts: { need: "project"; cwd?: string }): Promise<DxContextWithProject>;
export async function resolveDxContext(opts: { need: "workspace"; cwd?: string }): Promise<DxContextWithWorkspace>;
export async function resolveDxContext(opts: { need: "package"; cwd?: string }): Promise<DxContextWithPackage>;
export async function resolveDxContext(opts: { need: ContextNeed; cwd?: string }): Promise<DxContext> {
  const cwd = opts.cwd ?? process.cwd();

  // Return cached context if available for the same cwd
  let ctx: DxContext;
  if (_cachedCwd === cwd && _cachedCtx) {
    ctx = _cachedCtx;
  } else {
    // Phase 1: Host — always resolves
    const host = await resolveHostContext();

    // Phase 2: Project — walk up to find docker-compose root
    const project = resolveProjectContextData(cwd);

    // Phase 3: Workspace — detect from git plumbing
    const workspace = project ? resolveWorkspaceContextData(cwd, project) : null;

    // Phase 4: Package — match cwd against monorepo packages, or standalone detection
    const pkg = project
      ? resolvePackageContextData(cwd, project)
      : resolveStandalonePackageData(cwd);

    ctx = { host, project, workspace, package: pkg };
    _cachedCwd = cwd;
    _cachedCtx = ctx;
  }

  // Validate the requested tier is available
  switch (opts.need) {
    case "project":
      if (!ctx.project) throw new Error("Not inside a project directory (no docker-compose.yaml found).");
      break;
    case "workspace":
      if (!ctx.project) throw new Error("Not inside a project directory (no docker-compose.yaml found).");
      if (!ctx.workspace) throw new Error("Not inside a git workspace.");
      break;
    case "package":
      if (!ctx.project) throw new Error("Not inside a project directory (no docker-compose.yaml found).");
      if (!ctx.package) throw new Error("Not inside a package directory.");
      break;
  }

  return ctx;
}

// ---------------------------------------------------------------------------
// Tier resolvers
// ---------------------------------------------------------------------------

async function resolveHostContext(): Promise<HostContext> {
  // Global config (no project-local merge — that belongs to WorkspaceContext)
  const config = await dxConfigStore.read();

  // Session for the active auth profile (gracefully handle missing session on fresh install)
  let session: SessionPayload = {};
  try {
    const profile = resolveActiveProfile();
    session = profile === "default"
      ? await readSession()
      : await readSessionForProfile(profile);
  } catch {
    // No session file yet — return empty/unauthenticated session
  }

  // Conductor directory layout
  const home = homedir();
  const layout: ConductorLayout = {
    reposDir: config.workspaceReposDir || `${home}/conductor/repos`,
    worktreesDir: config.workspaceWorktreesDir || `${home}/conductor/workspaces`,
  };

  // Factory connection info
  const factory = resolveFactoryMode(config);

  return { config, session, layout, factory };
}

function resolveProjectContextData(cwd: string): ProjectContextData | null {
  // Check if we're inside a project (docker-compose root)
  const rootDir = findComposeRoot(cwd);
  if (!rootDir) return null;

  // Use existing ProjectContext as the resolution engine
  const project = ProjectContext.fromDir(rootDir);

  // Discover monorepo packages (fails gracefully if not a monorepo)
  let monorepoPackages: MonorepoPackage[] = [];
  try {
    const topology = monorepoFromCwd(rootDir);
    monorepoPackages = topology.packages;
  } catch {
    // Not a monorepo or no workspace config — fine
  }

  // Collect all unique profile names from components and resources
  const profiles = new Set<string>();
  for (const comp of Object.values(project.catalog.components)) {
    for (const p of comp.spec.profiles ?? []) profiles.add(p);
  }
  for (const res of Object.values(project.catalog.resources)) {
    for (const p of res.spec.profiles ?? []) profiles.add(p);
  }

  return {
    name: project.systemName,
    rootDir: project.rootDir,
    composeFiles: project.composeFiles,
    catalog: project.catalog,
    conventions: project.conventions,
    dxConfig: project.dxConfig,
    scripts: project.scripts,
    packageJson: project.packageJson as Record<string, unknown> | null,
    monorepoPackages,
    owner: project.dxConfig.team || project.catalog.spec.owner,
    allProfiles: [...profiles].sort(),
  };
}

function resolveWorkspaceContextData(cwd: string, project: ProjectContextData): WorkspaceContextData | null {
  // Detect worktree vs main checkout (use cwd, not project.rootDir, to handle
  // cases where cwd is inside a worktree that differs from the compose root)
  const worktree = getWorktreeInfo(cwd);

  let name: string;
  let dir: string;
  let kind: WorkspaceKind;
  let mainRepoDir: string;

  if (worktree) {
    name = worktree.worktreeName;
    dir = worktree.worktreeDir;
    kind = "worktree";
    mainRepoDir = worktree.mainRepoDir;
  } else {
    name = basename(project.rootDir);
    dir = project.rootDir;
    kind = "main";
    mainRepoDir = project.rootDir;
  }

  // Current branch
  let branch = "";
  try {
    branch = getCurrentBranch(dir);
  } catch {
    // Not a git repo or detached HEAD
  }

  // Compose project name — worktree name for isolation, project name for main
  const composeProjectName = worktree?.worktreeName ?? basename(project.rootDir);

  // Port manager from .dx/
  const dxDir = join(dir, ".dx");
  const ports = new PortManager(dxDir);

  // Project-local .dx/config.json overrides (read directly from JSON)
  let localConfig: Partial<DxConfig> = {};
  try {
    const localConfigPath = join(dxDir, "config.json");
    if (existsSync(localConfigPath)) {
      const raw = JSON.parse(readFileSync(localConfigPath, "utf8"));
      // Only keep non-empty string values as overrides
      for (const [key, val] of Object.entries(raw)) {
        if (typeof val === "string" && val.length > 0) {
          (localConfig as Record<string, string>)[key] = val;
        }
      }
    }
  } catch {
    // Malformed or unreadable — use empty overrides
  }

  // Auth profile from .dx/workbench.json
  let authProfile = "default";
  try {
    const workbenchPath = join(dxDir, "workbench.json");
    if (existsSync(workbenchPath)) {
      const workbench = JSON.parse(readFileSync(workbenchPath, "utf8"));
      if (typeof workbench.authProfile === "string" && workbench.authProfile.length > 0) {
        authProfile = workbench.authProfile;
      }
    }
  } catch {
    // malformed or missing — use default
  }

  return {
    name,
    dir,
    kind,
    branch,
    mainRepoDir,
    composeProjectName,
    ports,
    localConfig,
    authProfile,
  };
}

/** Walk up from cwd looking for package.json. */
function findPackageJsonRoot(cwd: string): string | null {
  let current = cwd;
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(current, "package.json"))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function runtimeToType(runtime: DetectedToolchain["runtime"]): PackageContextData["type"] {
  if (runtime === "python") return "python";
  if (runtime === "java") return "java";
  if (runtime === "go") return "go";
  if (runtime === "rust") return "rust";
  return "npm";
}

/**
 * Resolve package context when no project exists (no docker-compose).
 * This supports toolchain commands (lint, test, format, etc.) outside of projects.
 */
function resolveStandalonePackageData(cwd: string): PackageContextData | null {
  const rootDir = findPackageJsonRoot(cwd);
  if (!rootDir) return null;

  const toolchain = detectToolchain(rootDir);
  const scripts = loadPackageScripts(rootDir);
  const packageJson = loadPackageJson(rootDir);

  return {
    name: basename(rootDir),
    dir: rootDir,
    relativePath: ".",
    type: runtimeToType(toolchain.runtime),
    toolchain,
    manifest: { raw: packageJson ?? {}, dependencies: {}, devDependencies: {}, peerDependencies: {}, scripts } as PackageManifest,
    scripts,
  };
}

function resolvePackageContextData(cwd: string, project: ProjectContextData): PackageContextData | null {
  // For single-package projects (no monorepo packages), use project root as the package
  if (project.monorepoPackages.length === 0) {
    const toolchain = detectToolchain(project.rootDir);
    const scripts = project.scripts;
    return {
      name: project.name,
      dir: project.rootDir,
      relativePath: ".",
      type: runtimeToType(toolchain.runtime),
      toolchain,
      manifest: { raw: project.packageJson ?? {}, dependencies: {}, devDependencies: {}, peerDependencies: {}, scripts } as PackageManifest,
      scripts,
    };
  }

  // Match cwd against monorepo packages — find the most specific (longest path) match
  let best: MonorepoPackage | null = null;
  for (const pkg of project.monorepoPackages) {
    if (cwd === pkg.dir || cwd.startsWith(pkg.dir + "/")) {
      if (!best || pkg.dir.length > best.dir.length) {
        best = pkg;
      }
    }
  }

  if (!best) return null;

  const toolchain = detectToolchain(best.dir);
  const scripts = loadPackageScripts(best.dir);

  return {
    name: best.name,
    dir: best.dir,
    relativePath: relative(project.rootDir, best.dir),
    type: best.type as PackageContextData["type"],
    toolchain,
    manifest: best.manifest,
    scripts,
  };
}
