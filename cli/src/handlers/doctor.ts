/**
 * dx doctor — workbench health checks.
 *
 * Categories:
 *   toolchain  — required dev tools (node, java, python, docker, etc.)
 *   auth       — factory auth + registry credentials
 *   workbench  — identity, registration status
 *   workspace  — delegates to dx pkg doctor if inside a workspace
 */

import ora from "ora";
import { styleSuccess, styleError, styleWarn, styleMuted } from "../cli-style.js";
import { printToolchainResults } from "../lib/cli-ui.js";
import { runToolchainChecks } from "./install/toolchain.js";
import { readWorkbenchConfig } from "./install/workbench-identity.js";
import { getStoredBearerToken, resolveActiveProfile, getStoredBearerTokenForProfile } from "../session-token.js";
import { registryAuthStore } from "./pkg/registry-auth-store.js";

export interface DoctorOptions {
  category?: string;
  json?: boolean;
  verbose?: boolean;
}

interface DoctorResult {
  category: string;
  passed: boolean;
  details: Record<string, unknown>;
}

async function checkToolchain(verbose?: boolean): Promise<DoctorResult> {
  const spinner = ora({ text: "Checking toolchain...", prefixText: " " }).start();
  const result = await runToolchainChecks();
  spinner.stop();
  printToolchainResults(result.checks);

  return {
    category: "toolchain",
    passed: result.passed,
    details: {
      checks: result.checks.map((c) => ({
        name: c.name,
        passed: c.passed,
        version: c.version,
        required: c.required,
      })),
    },
  };
}

async function checkAuth(): Promise<DoctorResult> {
  console.log("\n  Auth");

  // Factory auth
  const profile = resolveActiveProfile();
  const token =
    profile === "default"
      ? await getStoredBearerToken()
      : await getStoredBearerTokenForProfile(profile);

  if (token) {
    console.log(`  ${styleSuccess("✔")} Factory auth${profile !== "default" ? ` (profile: ${profile})` : ""}`);
  } else {
    console.log(`  ${styleWarn("⚠")} Factory auth — not authenticated (run dx auth login)`);
  }

  // Registry auth
  let registryConfigured = false;
  try {
    const stored = await registryAuthStore.read();
    registryConfigured =
      stored.GOOGLE_APPLICATION_CREDENTIALS_BASE64.length > 0 ||
      stored.GCP_NPM_SA_JSON_BASE64.length > 0;
  } catch {
    // store unavailable
  }

  if (registryConfigured) {
    console.log(`  ${styleSuccess("✔")} Registry credentials`);
  } else {
    console.log(`  ${styleWarn("⚠")} Registry credentials — not configured (run dx pkg auth)`);
  }

  return {
    category: "auth",
    passed: !!token && registryConfigured,
    details: {
      factoryAuth: !!token,
      authProfile: profile,
      registryAuth: registryConfigured,
    },
  };
}

async function checkWorkbench(): Promise<DoctorResult> {
  console.log("\n  Workbench");

  // Walk up from cwd to find workbench root
  const path = await import("node:path");
  const { existsSync } = await import("node:fs");
  let dir = process.cwd();
  const root = path.parse(dir).root;
  let workbenchRoot: string | undefined;
  while (dir !== root) {
    if (existsSync(path.join(dir, ".dx", "workbench.json"))) {
      workbenchRoot = dir;
      break;
    }
    dir = path.dirname(dir);
  }

  if (!workbenchRoot) {
    console.log(`  ${styleWarn("⚠")} No workbench found — run dx install`);
    return { category: "workbench", passed: false, details: {} };
  }

  const config = readWorkbenchConfig(workbenchRoot);
  if (!config) {
    console.log(`  ${styleError("✖")} workbench.json corrupted at ${workbenchRoot}`);
    return { category: "workbench", passed: false, details: {} };
  }

  console.log(`  ${styleSuccess("✔")} ${config.workbenchId} (${config.type})`);
  console.log(`    ${styleMuted(`hostname: ${config.hostname}`)}`);
  console.log(`    ${styleMuted(`os: ${config.os}/${config.arch}`)}`);
  console.log(`    ${styleMuted(`root: ${workbenchRoot}`)}`);
  console.log(`    ${styleMuted(`installed: ${config.lastInstallAt}`)}`);

  if (config.factoryRegistered) {
    console.log(`  ${styleSuccess("✔")} Registered with factory`);
  } else {
    console.log(`  ${styleMuted("  Not registered with factory")}`);
  }

  return {
    category: "workbench",
    passed: true,
    details: {
      workbenchId: config.workbenchId,
      type: config.type,
      hostname: config.hostname,
      factoryRegistered: config.factoryRegistered,
    },
  };
}

async function checkWorkspace(): Promise<DoctorResult> {
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const cwd = process.cwd();

  if (!existsSync(join(cwd, "pnpm-workspace.yaml")) && !existsSync(join(cwd, "package.json"))) {
    return { category: "workspace", passed: true, details: { found: false } };
  }

  console.log("\n  Workspace");

  try {
    const { pkgDoctor } = await import("./pkg/doctor.js");
    await pkgDoctor(cwd, { verbose: false });
  } catch (err) {
    console.log(`  ${styleWarn("⚠")} Workspace check failed: ${err instanceof Error ? err.message : String(err)}`);
    return { category: "workspace", passed: false, details: {} };
  }

  return { category: "workspace", passed: true, details: { found: true } };
}

const CATEGORIES: Record<string, () => Promise<DoctorResult>> = {
  toolchain: checkToolchain,
  auth: checkAuth,
  workbench: checkWorkbench,
  workspace: checkWorkspace,
};

export async function runDoctor(opts: DoctorOptions): Promise<void> {
  console.log("\n  dx doctor\n");

  const categoriesToRun = opts.category
    ? [opts.category]
    : Object.keys(CATEGORIES);

  if (opts.category && !CATEGORIES[opts.category]) {
    throw new Error(
      `Unknown category: ${opts.category}\nAvailable: ${Object.keys(CATEGORIES).join(", ")}`,
    );
  }

  const results: DoctorResult[] = [];
  for (const cat of categoriesToRun) {
    const result = await CATEGORIES[cat]();
    results.push(result);
  }

  const allPassed = results.every((r) => r.passed);
  console.log();
  if (allPassed) {
    console.log(`  ${styleSuccess("✔")} All checks passed`);
  } else {
    console.log(`  ${styleWarn("⚠")} Some checks need attention`);
  }
  console.log();

  if (opts.json) {
    console.log(JSON.stringify({ success: allPassed, results }, null, 2));
  }
}
