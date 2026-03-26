/**
 * Package detection helpers — source resolution, name derivation, type
 * detection, and git status utilities.
 */

import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { capture } from "../../lib/subprocess.js";
import type { PackageEntry } from "./state.js";

/** Expand GitHub shorthand (org/repo) to a full git URL. */
export function resolveSource(source: string): string {
  if (
    source.startsWith("https://") ||
    source.startsWith("git@") ||
    source.startsWith("ssh://") ||
    source.startsWith("http://")
  ) {
    return source;
  }
  if (source.includes("/") && !source.startsWith(".")) {
    return `https://github.com/${source}.git`;
  }
  throw new Error(
    `Cannot resolve source: ${source}\nUse a git URL or GitHub shorthand (e.g. LeptonSoftware/auth-utils)`
  );
}

/** Extract a package name from the URL, path, or override. */
export function deriveName(
  source: string,
  sourcePath?: string,
  nameOverride?: string
): string {
  if (nameOverride) return nameOverride;
  if (sourcePath) return basename(sourcePath);
  const last = source.replace(/\/$/, "").split("/").pop() ?? source;
  return last.replace(/\.git$/, "");
}

/** Return 'npm', 'java', or 'python' based on manifest files. */
export function detectPkgType(
  pkgDir: string
): "npm" | "java" | "python" | null {
  if (existsSync(join(pkgDir, "package.json"))) return "npm";
  if (existsSync(join(pkgDir, "pom.xml"))) return "java";
  if (existsSync(join(pkgDir, "pyproject.toml"))) return "python";
  return null;
}

const TYPE_DIRS: Record<string, string> = {
  npm: "npm",
  java: "java",
  python: "python",
};

/**
 * Target directory for a package.
 *
 * Adapts to the project structure:
 *   - If `packages/<type>/` exists → `packages/<type>/<name>` (standard project)
 *   - Else if `packages/` exists  → `packages/<name>` (flat layout)
 *   - Otherwise                   → `<name>/` at root (bare directory)
 */
export function targetDir(root: string, pkgType: string, name: string): string {
  const typedDir = join(root, "packages", TYPE_DIRS[pkgType]);
  if (existsSync(typedDir)) return join(typedDir, name);
  const packagesDir = join(root, "packages");
  if (existsSync(packagesDir)) return join(packagesDir, name);
  return join(root, name);
}

/**
 * Resolve an existing package by short name.
 * Checks `packages/<type>/<name>` for each type, then `packages/<name>`.
 * Returns the first match or null.
 */
export function resolveExistingPackage(
  root: string,
  name: string,
): { dir: string; type: "npm" | "java" | "python"; name: string } | null {
  for (const typeDir of ["npm", "java", "python"] as const) {
    const c = join(root, "packages", typeDir, name);
    if (existsSync(c)) {
      const pt = detectPkgType(c);
      if (pt) return { dir: c, type: pt, name };
    }
  }
  // Flat packages/ layout
  const flat = join(root, "packages", name);
  if (existsSync(flat)) {
    const pt = detectPkgType(flat);
    if (pt) return { dir: flat, type: pt, name };
  }
  return null;
}

/**
 * Return the actual git repo directory for a package.
 * For monorepo subpath packages this is .dx/pkg-repos/<name>/ (the full clone).
 * For whole-repo packages this is the local_path itself.
 */
export function gitRepoDir(entry: PackageEntry, root: string): string {
  if (entry.repo_path) return join(root, entry.repo_path);
  return join(root, entry.local_path);
}

/**
 * Return (status, changedFileCount) for a package.
 * For subpath packages, scopes to source_path within the repo.
 */
export async function gitStatusSummary(
  entry: PackageEntry,
  root: string,
): Promise<{ status: "clean" | "modified" | "unknown"; count: number }> {
  const repoDir = gitRepoDir(entry, root);

  const args = ["git", "status", "--porcelain"];
  if (entry.source_path) {
    args.push("--", entry.source_path);
  }

  const result = await capture(args, { cwd: repoDir });
  if (result.exitCode !== 0) return { status: "unknown", count: 0 };

  const lines = result.stdout
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { status: "clean", count: 0 };
  return { status: "modified", count: lines.length };
}

/**
 * Walk up from startDir to find the nearest directory containing `.dx/`.
 * Stops before the home directory (whose `~/.dx` is the shared-repos root,
 * not a project). Returns `startDir` as fallback so commands still work
 * from a bare directory.
 */
export function findPkgRoot(startDir: string): string {
  const home = homedir();
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, ".dx"))) return dir;
    const parent = dirname(dir);
    if (parent === dir || parent === home) break;
    dir = parent;
  }
  return startDir; // fallback: cwd itself
}

/** Shorten a GitHub URL for display. */
export function shortSource(source: string): string {
  const m = source.match(/^https:\/\/github\.com\/(.+?)(?:\.git)?$/);
  if (m) return m[1];
  return source;
}
