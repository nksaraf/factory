/**
 * Package detection helpers — source resolution, name derivation, type
 * detection, and git status utilities.
 */

import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { run } from "../../lib/subprocess.js";
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

/** Target directory for a package type. */
export function targetDir(root: string, pkgType: string, name: string): string {
  return join(root, "packages", TYPE_DIRS[pkgType], name);
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
export function gitStatusSummary(
  entry: PackageEntry,
  root: string
): { status: "clean" | "modified" | "unknown"; count: number } {
  const repoDir = gitRepoDir(entry, root);

  const args = ["status", "--porcelain"];
  if (entry.source_path) {
    args.push("--", entry.source_path);
  }

  const result = run("git", args, { cwd: repoDir });
  if (result.status !== 0) return { status: "unknown", count: 0 };

  const lines = result.stdout
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { status: "clean", count: 0 };
  return { status: "modified", count: lines.length };
}

/** Shorten a GitHub URL for display. */
export function shortSource(source: string): string {
  const m = source.match(/^https:\/\/github\.com\/(.+?)(?:\.git)?$/);
  if (m) return m[1];
  return source;
}
