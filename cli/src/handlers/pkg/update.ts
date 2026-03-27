/**
 * dx pkg update [dep] — update dependencies across workspace packages.
 *
 * npm    → pnpm update / pnpm outdated with interactive picker
 * python → pip list --outdated / uv pip list --outdated
 * java   → mvn versions:display-dependency-updates
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { exec, capture } from "../../lib/subprocess.js";
import {
  fromCwd,
  type WorkspaceContext,
} from "../../lib/workspace-context.js";
import { printTable } from "../../output.js";
import { styleSuccess, styleWarn, styleMuted } from "../../cli-style.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface UpdateOptions {
  dep?: string;
  latest?: boolean;
  dryRun?: boolean;
  json?: boolean;
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// npm update
// ---------------------------------------------------------------------------

interface OutdatedEntry {
  current: string;
  latest: string;
  wanted: string;
  dependent: string;
  name?: string;
}

async function updateNpm(
  ws: WorkspaceContext,
  opts: UpdateOptions,
): Promise<void> {
  if (!existsSync(join(ws.root, "pnpm-workspace.yaml"))) return;

  if (opts.dep) {
    if (opts.dryRun) {
      const result = await capture(
        ["pnpm", "outdated", opts.dep, "--json", "-r"],
        { cwd: ws.root },
      );
      if (result.stdout.trim()) {
        console.log(result.stdout);
      } else {
        console.log(`${opts.dep} is up to date.`);
      }
      return;
    }

    // Check if dep is in pnpm.overrides
    if (ws.pnpmOverrides[opts.dep]) {
      console.log(
        styleWarn(
          `Note: ${opts.dep} is in pnpm.overrides (${ws.pnpmOverrides[opts.dep]}). You may want to update the override as well.`,
        ),
      );
    }

    const args = ["pnpm", "update", opts.dep, "-r"];
    if (opts.latest) args.push("--latest");
    await exec(args, { cwd: ws.root });
    return;
  }

  // No specific dep — show outdated and optionally update
  if (opts.dryRun || !opts.latest) {
    const result = await capture(["pnpm", "outdated", "--json", "-r"], {
      cwd: ws.root,
    });

    if (result.exitCode !== 0 && !result.stdout.trim()) {
      console.log(styleSuccess("All dependencies are up to date."));
      return;
    }

    try {
      const data = JSON.parse(result.stdout);

      if (opts.json) {
        console.log(JSON.stringify({ success: true, data }, null, 2));
        return;
      }

      // Format outdated deps as table
      const rows: string[][] = [];
      if (Array.isArray(data)) {
        for (const entry of data) {
          const deps = entry.dependencies ?? {};
          const devDeps = entry.devDependencies ?? {};
          const allDeps = { ...deps, ...devDeps };
          for (const [name, info] of Object.entries(
            allDeps as Record<string, OutdatedEntry>,
          )) {
            rows.push([
              name,
              info.current ?? "?",
              info.wanted ?? "?",
              info.latest ?? "?",
              entry.name ?? "",
            ]);
          }
        }
      } else if (typeof data === "object") {
        for (const [name, info] of Object.entries(
          data as Record<string, OutdatedEntry>,
        )) {
          rows.push([
            name,
            info.current ?? "?",
            info.wanted ?? "?",
            info.latest ?? "?",
            info.dependent ?? "",
          ]);
        }
      }

      if (rows.length > 0) {
        console.log(
          printTable(
            ["Package", "Current", "Wanted", "Latest", "Dependent"],
            rows,
          ),
        );
      } else {
        console.log(styleSuccess("All dependencies are up to date."));
      }

      if (opts.dryRun) return;

      // Interactive update if not --latest and not dry-run
      if (rows.length > 0 && !opts.latest) {
        const { checkbox } = await import("@inquirer/prompts");
        const choices = rows.map((r) => ({
          name: `${r[0]} ${styleMuted(r[1])} → ${styleSuccess(r[3])}`,
          value: r[0],
        }));

        const selected = await checkbox({
          message: "Select dependencies to update:",
          choices,
        });

        if (selected.length > 0) {
          for (const dep of selected) {
            await exec(["pnpm", "update", dep, "-r", "--latest"], {
              cwd: ws.root,
            });
          }
        }
      }
    } catch {
      if (result.stdout.trim()) console.log(result.stdout);
    }
    return;
  }

  // --latest: update everything
  await exec(["pnpm", "update", "--latest", "-r"], { cwd: ws.root });
}

// ---------------------------------------------------------------------------
// Python update
// ---------------------------------------------------------------------------

async function updatePython(
  ws: WorkspaceContext,
  opts: UpdateOptions,
): Promise<void> {
  const pythonPkgs = ws.packages.filter((p) => p.type === "python");
  if (pythonPkgs.length === 0) return;

  const uvCheck = await capture(["which", "uv"]);
  const useUv = uvCheck.exitCode === 0;

  if (opts.dryRun) {
    const cmd = useUv
      ? ["uv", "pip", "list", "--outdated"]
      : ["pip", "list", "--outdated", "--format", "json"];

    for (const pkg of pythonPkgs) {
      console.log(`\n${pkg.name}:`);
      await exec(cmd, { cwd: pkg.dir });
    }
    return;
  }

  for (const pkg of pythonPkgs) {
    if (useUv) {
      await exec(["uv", "sync", "--upgrade"], { cwd: pkg.dir });
    } else {
      await exec(["pip", "install", "--upgrade", "-e", "."], {
        cwd: pkg.dir,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Java update
// ---------------------------------------------------------------------------

async function updateJava(
  ws: WorkspaceContext,
  opts: UpdateOptions,
): Promise<void> {
  const javaPkgs = ws.packages.filter((p) => p.type === "java");
  if (javaPkgs.length === 0) return;

  const parentDirs = [join(ws.root, "packages", "java"), ws.root];
  for (const parentDir of parentDirs) {
    if (!existsSync(join(parentDir, "pom.xml"))) continue;
    await exec(["mvn", "versions:display-dependency-updates"], {
      cwd: parentDir,
    });
    return;
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function pkgUpdate(
  root: string,
  opts: UpdateOptions,
): Promise<void> {
  const ws = fromCwd(root);

  if (ws.packages.length === 0) {
    console.log("No workspace packages found.");
    return;
  }

  await updateNpm(ws, opts);
  await updatePython(ws, opts);
  await updateJava(ws, opts);

  // After updates, sync lockfile
  if (!opts.dryRun && existsSync(join(ws.root, "pnpm-workspace.yaml"))) {
    console.log(styleMuted("\nSyncing lockfile..."));
    await exec(["pnpm", "install"], { cwd: ws.root });
  }
}
