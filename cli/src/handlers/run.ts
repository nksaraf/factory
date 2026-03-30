// cli/src/handlers/run.ts
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, extname } from "node:path";

import {
  resolveRecipe,
  resolveParams,
  type ResolvedRecipe,
} from "../lib/recipe.js";
import {
  expandTargets,
  resolveMachine,
  type MachineTarget,
} from "../lib/machine-target.js";
import { buildSshArgs } from "../handlers/docker-remote.js";
import {
  styleBold,
  styleMuted,
  styleSuccess,
  styleError,
} from "../commands/list-helpers.js";

// ─── Input type detection ─────────────────────────────────────

export type InputType = "script-ts" | "script-sh" | "recipe" | "unknown";

export function detectInputType(input: string): InputType {
  const ext = extname(input).toLowerCase();

  // File extensions
  if (ext === ".ts" || ext === ".js" || ext === ".mts" || ext === ".mjs") return "script-ts";
  if (ext === ".sh") return "script-sh";

  // @dx/ prefix → built-in recipe
  if (input.startsWith("@dx/")) return "recipe";

  // Directory with recipe.yml
  if (existsSync(resolve(input, "recipe.yml"))) return "recipe";

  // Bare name → try recipe resolution
  // We check this last — if a recipe exists with this name, it's a recipe
  try {
    resolveRecipe(input);
    return "recipe";
  } catch {
    // Not a recipe
  }

  return "unknown";
}

// ─── Script execution (local) ─────────────────────────────────

export async function runScriptLocal(
  file: string,
  opts: { watch?: boolean; passthrough: string[]; environment?: string; noSecrets?: boolean },
): Promise<void> {
  const { runScript } = await import("./script.js");
  await runScript({
    file,
    watch: opts.watch,
    passthrough: opts.passthrough,
    environment: opts.environment,
    noSecrets: opts.noSecrets,
  });
}

// ─── Shell script execution (remote) ──────────────────────────

export async function runShellScriptRemote(
  file: string,
  target: MachineTarget,
  extraEnv: Record<string, string>,
): Promise<void> {
  const resolved = resolve(file);
  if (!existsSync(resolved)) {
    throw new Error(`Script not found: ${resolved}`);
  }
  const script = readFileSync(resolved, "utf-8");
  const sshArgs = buildSshArgs(target);

  // Build env export preamble
  const envExports = Object.entries(extraEnv)
    .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
    .join("\n");

  const fullScript = envExports ? `${envExports}\n${script}` : script;

  try {
    execFileSync("ssh", [...sshArgs, "bash -s"], {
      stdio: ["pipe", "inherit", "inherit"],
      input: fullScript,
    });
  } catch (err: any) {
    if (err.status != null) throw err;
    throw err;
  }
}

// ─── Recipe execution ─────────────────────────────────────────

interface RunRecipeOpts {
  recipeName: string;
  targets: MachineTarget[];
  paramEnv: Record<string, string>;
  dryRun?: boolean;
  force?: boolean;
}

export async function runRecipe(opts: RunRecipeOpts): Promise<void> {
  const recipe = resolveRecipe(opts.recipeName);

  // Check dependencies recursively
  await checkAndApplyDependencies(recipe, opts.targets, opts.paramEnv, new Set());

  const isMulti = opts.targets.length > 1;
  if (isMulti) {
    console.log(`Running ${styleBold(recipe.manifest.name)} on ${opts.targets.length} machine(s)...\n`);
  }

  const results: Array<{ name: string; status: string; duration: number }> = [];

  for (const target of opts.targets) {
    const start = Date.now();
    try {
      await runRecipeOnMachine(recipe, target, opts.paramEnv, opts.dryRun, opts.force);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      results.push({ name: target.name, status: "applied", duration: Date.now() - start });
      if (isMulti) {
        console.log(`  ${target.name}  ${styleSuccess("✓")}  applied (${elapsed}s)`);
      }
    } catch (err: any) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const msg = err.message ?? String(err);

      // Check if "already applied" (verify.sh passed)
      if (msg === "__already_applied__") {
        results.push({ name: target.name, status: "skipped", duration: Date.now() - start });
        if (isMulti) {
          console.log(`  ${target.name}  ${styleSuccess("✓")}  already applied (skipped)`);
        } else {
          console.log(styleMuted(`Recipe "${recipe.manifest.name}" is already applied on ${target.name}. Use --force to re-apply.`));
        }
        continue;
      }

      results.push({ name: target.name, status: `failed: ${msg}`, duration: Date.now() - start });
      if (isMulti) {
        console.log(`  ${target.name}  ${styleError("✗")}  failed (${elapsed}s): ${msg}`);
      } else {
        throw err;
      }
    }
  }
}

async function runRecipeOnMachine(
  recipe: ResolvedRecipe,
  target: MachineTarget,
  paramEnv: Record<string, string>,
  dryRun?: boolean,
  force?: boolean,
): Promise<void> {
  const sshArgs = buildSshArgs(target);
  const machineEnv: Record<string, string> = {
    ...paramEnv,
    DX_MACHINE_NAME: target.name,
    DX_MACHINE_HOST: target.host,
    DX_MACHINE_USER: target.user,
    DX_RECIPE_NAME: recipe.manifest.name,
  };

  // Build env export preamble
  const envExports = Object.entries(machineEnv)
    .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
    .join("\n");

  // Verify step
  if (recipe.verifyScript) {
    const verifyScript = `${envExports}\n${recipe.verifyScript}`;
    const verifyResult = spawnSync("ssh", [...sshArgs, "bash -s"], {
      input: verifyScript,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
    });

    if (dryRun) {
      if (verifyResult.status === 0) {
        console.log(styleSuccess(`[dry-run] ${recipe.manifest.name} is already applied on ${target.name}`));
      } else {
        console.log(styleMuted(`[dry-run] ${recipe.manifest.name} needs to be applied on ${target.name}`));
      }
      return;
    }

    if (verifyResult.status === 0 && !force) {
      throw new Error("__already_applied__");
    }
  } else if (dryRun) {
    console.log(styleMuted(`[dry-run] ${recipe.manifest.name} has no verify.sh — cannot determine state on ${target.name}`));
    return;
  }

  // Install step
  console.log(`Applying ${styleBold(recipe.manifest.name)} on ${target.name}...`);
  const installScript = `${envExports}\n${recipe.installScript}`;

  try {
    execFileSync("ssh", [...sshArgs, "bash -s"], {
      stdio: ["pipe", "inherit", "inherit"],
      input: installScript,
    });
  } catch (err: any) {
    if (err.status != null) {
      throw new Error(`Recipe "${recipe.manifest.name}" failed on ${target.name} (exit code ${err.status})`);
    }
    throw err;
  }

  console.log(styleSuccess(`Recipe "${recipe.manifest.name}" applied on ${target.name}`));
}

async function checkAndApplyDependencies(
  recipe: ResolvedRecipe,
  targets: MachineTarget[],
  paramEnv: Record<string, string>,
  visited: Set<string>,
): Promise<void> {
  const deps = recipe.manifest.requires ?? [];
  if (deps.length === 0) return;

  for (const depName of deps) {
    if (visited.has(depName)) {
      throw new Error(`Circular dependency detected: ${[...visited, depName].join(" → ")}`);
    }
    visited.add(depName);

    const depRecipe = resolveRecipe(depName);

    // Recursively check deps of deps
    await checkAndApplyDependencies(depRecipe, targets, {}, visited);

    // Check if dep is satisfied on each target
    if (depRecipe.verifyScript) {
      for (const target of targets) {
        const sshArgs = buildSshArgs(target);
        const result = spawnSync("ssh", [...sshArgs, "bash -s"], {
          input: depRecipe.verifyScript,
          stdio: ["pipe", "pipe", "pipe"],
          encoding: "utf8",
        });

        if (result.status !== 0) {
          console.log(styleMuted(`Dependency "${depName}" not satisfied on ${target.name} — applying...`));
          await runRecipeOnMachine(depRecipe, target, {}, false, false);
        }
      }
    }
  }
}
