/**
 * dx doctor — workbench health checks.
 *
 * Categories:
 *   toolchain  — required dev tools (node, java, python, docker, etc.)
 *   auth       — factory auth + registry credentials
 *   workbench  — identity, registration status
 *   workspace  — delegates to dx pkg doctor if inside a workspace
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";

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

async function checkProject(): Promise<DoctorResult> {
  console.log("\n  Project");

  // Find compose root by walking up
  let dir = process.cwd();
  const root = (await import("node:path")).parse(dir).root;
  let composeRoot: string | undefined;
  while (dir !== root) {
    const composePath = join(dir, "docker-compose.yaml");
    if (existsSync(composePath)) {
      const content = readFileSync(composePath, "utf8");
      if (content.includes("include:")) {
        composeRoot = dir;
        break;
      }
    }
    dir = dirname(dir);
  }

  if (!composeRoot) {
    console.log(`  ${styleMuted("Not inside a dx project — skipping")}`);
    return { category: "project", passed: true, details: { found: false } };
  }

  const issues: string[] = [];
  const composePath = join(composeRoot, "docker-compose.yaml");
  const content = readFileSync(composePath, "utf8");

  // Parse include paths
  const includePaths: string[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*-\s*path:\s*(.+)$/);
    if (match) includePaths.push(match[1]!.trim());
  }

  // Check 1: All referenced compose files exist
  const missingFiles: string[] = [];
  for (const inc of includePaths) {
    if (!existsSync(join(composeRoot, inc))) {
      missingFiles.push(inc);
    }
  }
  if (missingFiles.length > 0) {
    issues.push(`Missing compose files: ${missingFiles.join(", ")}`);
    console.log(`  ${styleError("✖")} ${missingFiles.length} compose file(s) missing from docker-compose.yaml`);
    for (const f of missingFiles) {
      console.log(`    ${styleMuted(f)}`);
    }
  } else {
    console.log(`  ${styleSuccess("✔")} All ${includePaths.length} compose files exist`);
  }

  // Check 2: Dockerfiles exist for services with build context
  const missingDockerfiles: string[] = [];
  for (const inc of includePaths) {
    const filePath = join(composeRoot, inc);
    if (!existsSync(filePath)) continue;
    const ymlContent = readFileSync(filePath, "utf8");

    // Simple regex to find build.context and build.dockerfile
    const contextMatch = ymlContent.match(/context:\s*(.+)/);
    const dockerfileMatch = ymlContent.match(/dockerfile:\s*(.+)/);
    if (contextMatch) {
      const ctx = contextMatch[1]!.trim();
      const dockerfile = dockerfileMatch ? dockerfileMatch[1]!.trim() : "Dockerfile";
      // Resolve relative to the compose file's directory
      const composeDir = dirname(filePath);
      const fullDockerfile = join(composeDir, ctx, dockerfile);
      if (!existsSync(fullDockerfile)) {
        const relPath = `${dirname(inc)}/${ctx}/${dockerfile}`;
        missingDockerfiles.push(relPath);
      }
    }
  }
  if (missingDockerfiles.length > 0) {
    issues.push(`Missing Dockerfiles: ${missingDockerfiles.join(", ")}`);
    console.log(`  ${styleWarn("⚠")} ${missingDockerfiles.length} Dockerfile(s) missing`);
    for (const f of missingDockerfiles) {
      console.log(`    ${styleMuted(f)}`);
    }
  } else {
    const buildCount = includePaths.filter((inc) => {
      const fp = join(composeRoot, inc);
      if (!existsSync(fp)) return false;
      return readFileSync(fp, "utf8").includes("context:");
    }).length;
    if (buildCount > 0) {
      console.log(`  ${styleSuccess("✔")} All ${buildCount} Dockerfile(s) present`);
    }
  }

  // Check 3: Port conflicts across compose files
  const portMap = new Map<number, string[]>(); // hostPort → [service names]
  for (const inc of includePaths) {
    const filePath = join(composeRoot, inc);
    if (!existsSync(filePath)) continue;
    const ymlContent = readFileSync(filePath, "utf8");

    // Extract default host ports: "${VAR:-HOST}:CONTAINER" or "HOST:CONTAINER"
    const portRe = /["']?\$\{[^}]*:-(\d+)\}:(\d+)["']?|["']?(\d+):(\d+)["']?/g;
    let portMatch: RegExpExecArray | null;
    while ((portMatch = portRe.exec(ymlContent)) !== null) {
      const hostPort = parseInt(portMatch[1] || portMatch[3]!, 10);
      const serviceName = inc.replace("compose/", "").replace(".yml", "");
      if (!portMap.has(hostPort)) portMap.set(hostPort, []);
      portMap.get(hostPort)!.push(serviceName);
    }
  }

  const conflicts: string[] = [];
  for (const [port, services] of portMap) {
    if (services.length > 1) {
      conflicts.push(`Port ${port} used by: ${services.join(", ")}`);
    }
  }
  if (conflicts.length > 0) {
    issues.push(...conflicts);
    console.log(`  ${styleWarn("⚠")} ${conflicts.length} port conflict(s)`);
    for (const c of conflicts) {
      console.log(`    ${styleMuted(c)}`);
    }
  } else {
    console.log(`  ${styleSuccess("✔")} No port conflicts (${portMap.size} ports configured)`);
  }

  return {
    category: "project",
    passed: issues.length === 0,
    details: {
      found: true,
      root: composeRoot,
      includeCount: includePaths.length,
      missingFiles,
      missingDockerfiles,
      portConflicts: conflicts,
    },
  };
}

const CATEGORIES: Record<string, () => Promise<DoctorResult>> = {
  toolchain: checkToolchain,
  auth: checkAuth,
  workbench: checkWorkbench,
  workspace: checkWorkspace,
  project: checkProject,
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
