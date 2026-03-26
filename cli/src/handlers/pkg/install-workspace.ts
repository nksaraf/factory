/**
 * dx pkg install — cross-language smart install for workspace packages.
 *
 * Groups discovered packages by type and runs the appropriate installer:
 *   npm   → pnpm install (at workspace root)
 *   python → pip install -e . or uv sync per package
 *   java  → mvn install -DskipTests from parent pom
 *
 * npm packages run first since they may be workspace deps for other languages.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { exec, capture } from "../../lib/subprocess.js";
import {
  fromCwd,
  filterPackages,
  type WorkspaceContext,
  type WorkspacePackage,
} from "../../lib/workspace-context.js";
import { styleSuccess, styleMuted } from "../../cli-style.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface InstallWorkspaceOptions {
  frozen?: boolean;
  filter?: string;
  json?: boolean;
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// Per-ecosystem installers
// ---------------------------------------------------------------------------

async function installNpm(
  ws: WorkspaceContext,
  pkgs: WorkspacePackage[],
  opts: InstallWorkspaceOptions,
): Promise<void> {
  if (pkgs.length === 0) return;

  const args = ["pnpm", "install"];
  if (opts.frozen) args.push("--frozen-lockfile");

  // If filtering to specific packages, use pnpm --filter
  if (opts.filter) {
    for (const pkg of pkgs) {
      await exec(["pnpm", "install", "--filter", pkg.name], { cwd: ws.root });
    }
  } else {
    await exec(args, { cwd: ws.root });
  }
}

async function installPython(
  ws: WorkspaceContext,
  pkgs: WorkspacePackage[],
  opts: InstallWorkspaceOptions,
): Promise<void> {
  for (const pkg of pkgs) {
    // Prefer uv if available
    const uvCheck = await capture(["which", "uv"]);
    if (uvCheck.exitCode === 0) {
      await exec(["uv", "sync"], { cwd: pkg.dir });
    } else {
      await exec(["pip", "install", "-e", "."], { cwd: pkg.dir });
    }
  }
}

async function installJava(
  ws: WorkspaceContext,
  pkgs: WorkspacePackage[],
  opts: InstallWorkspaceOptions,
): Promise<void> {
  if (pkgs.length === 0) return;

  // Find the parent pom directory
  const parentDirs = [join(ws.root, "packages", "java"), ws.root];
  for (const parentDir of parentDirs) {
    if (!existsSync(join(parentDir, "pom.xml"))) continue;
    await exec(["mvn", "install", "-DskipTests"], { cwd: parentDir });
    return;
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function pkgInstall(
  root: string,
  opts: InstallWorkspaceOptions,
): Promise<void> {
  const ws = fromCwd(root);
  const pkgs = filterPackages(ws, opts.filter);

  if (pkgs.length === 0) {
    console.log("No workspace packages found.");
    return;
  }

  const npmPkgs = pkgs.filter((p) => p.type === "npm");
  const pythonPkgs = pkgs.filter((p) => p.type === "python");
  const javaPkgs = pkgs.filter((p) => p.type === "java");

  const summary: Array<{ type: string; count: number; status: string }> = [];

  // npm first
  if (npmPkgs.length > 0) {
    try {
      await installNpm(ws, npmPkgs, opts);
      summary.push({ type: "npm", count: npmPkgs.length, status: "ok" });
    } catch (err) {
      summary.push({ type: "npm", count: npmPkgs.length, status: "failed" });
      if (!opts.filter) throw err;
    }
  }

  if (pythonPkgs.length > 0) {
    try {
      await installPython(ws, pythonPkgs, opts);
      summary.push({
        type: "python",
        count: pythonPkgs.length,
        status: "ok",
      });
    } catch (err) {
      summary.push({
        type: "python",
        count: pythonPkgs.length,
        status: "failed",
      });
    }
  }

  if (javaPkgs.length > 0) {
    try {
      await installJava(ws, javaPkgs, opts);
      summary.push({ type: "java", count: javaPkgs.length, status: "ok" });
    } catch (err) {
      summary.push({
        type: "java",
        count: javaPkgs.length,
        status: "failed",
      });
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({ success: true, summary }, null, 2));
  } else {
    for (const s of summary) {
      const icon = s.status === "ok" ? styleSuccess("✓") : "✗";
      console.log(`${icon} ${s.type}: ${s.count} package(s) ${styleMuted(s.status)}`);
    }
  }
}
