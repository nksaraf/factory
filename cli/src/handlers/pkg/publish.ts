/**
 * dx pkg publish — build and publish packages to GCP Artifact Registry.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run, runInherit } from "../../lib/subprocess.js";
import { PackageState } from "./state.js";
import { detectPkgType } from "./detect.js";
import {
  REGISTRIES,
  loadSaJson,
  checkWriteAccessGate,
  configureNpmAuth,
  pythonRepositoryUrl,
  pythonTwineEnv,
} from "./registry.js";

export interface PublishOptions {
  target: string;
  dryRun?: boolean;
  keyFile?: string;
  verbose?: boolean;
}

export async function pkgPublish(
  root: string,
  opts: PublishOptions
): Promise<void> {
  // Resolve package
  const { dir, type, name } = resolveTarget(root, opts.target);

  if (opts.dryRun) {
    console.log(`[dry-run] Would publish ${name} (${type}) from ${dir}`);
    return;
  }

  // Check write access gate
  if (!(await checkWriteAccessGate(type, root))) {
    throw new Error(
      `Write access not configured for ${type} registry.\n` +
        "Run 'dx pkg auth' to configure credentials with write access."
    );
  }

  if (type === "npm") await publishNpm(root, dir, name);
  else if (type === "java") await publishJava(root, dir, name);
  else if (type === "python")
    await publishPython(root, dir, name, opts.keyFile);
  else throw new Error(`Unknown package type: ${type}`);
}

function resolveTarget(
  root: string,
  target: string
): { dir: string; type: string; name: string } {
  // Try tracked packages
  const pm = new PackageState(root);
  const entry = pm.get(target);
  if (entry) {
    return {
      dir: join(root, entry.local_path),
      type: entry.type,
      name: target,
    };
  }

  // Try packages/<type>/<target>
  for (const typeDir of ["npm", "java", "python"]) {
    const candidate = join(root, "packages", typeDir, target);
    if (existsSync(candidate)) {
      return { dir: candidate, type: typeDir, name: target };
    }
  }

  // Try as direct path
  const candidate = join(root, target);
  if (existsSync(candidate)) {
    const type = detectPkgType(candidate);
    if (type) {
      return { dir: candidate, type, name: target.split("/").pop()! };
    }
  }

  throw new Error(`Package '${target}' not found`);
}

async function publishNpm(
  root: string,
  pkgDir: string,
  pkgName: string
): Promise<void> {
  const pkgJson = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  const scripts = pkgJson.scripts ?? {};

  if ("build" in scripts) {
    console.log("Running build...");
    const rc = runInherit("pnpm", ["run", "build"], { cwd: pkgDir });
    if (rc !== 0) throw new Error("Build failed — fix errors before publishing");
  }

  // Refresh GCP Artifact Registry token before publishing
  const saJson = await loadSaJson("npm", root);
  if (saJson) {
    console.log("Refreshing Artifact Registry token...");
    if (!configureNpmAuth(saJson, root)) {
      console.warn("Warning: token refresh failed — publish may fail with 403");
    }
  }

  console.log(`Publishing ${pkgName} to npm Artifact Registry...`);
  const rc = runInherit(
    "pnpm",
    ["publish", "--no-git-checks", "--access", "restricted"],
    { cwd: pkgDir }
  );
  if (rc !== 0) throw new Error("Publish failed");

  console.log(`Published ${pkgName} to npm Artifact Registry`);
  console.log(`  Version: ${pkgJson.version ?? "?"}`);
  console.log(`  Registry: ${REGISTRIES.npm.url}`);
}

async function publishJava(
  root: string,
  pkgDir: string,
  pkgName: string
): Promise<void> {
  const pomContent = readFileSync(join(pkgDir, "pom.xml"), "utf8");
  if (!pomContent.includes("distributionManagement")) {
    throw new Error(
      `Package ${pkgName} has no <distributionManagement> in pom.xml`
    );
  }

  console.log(`Building ${pkgName}...`);
  let rc = runInherit("mvn", ["clean", "install", "-DskipTests"], {
    cwd: pkgDir,
  });
  if (rc !== 0) throw new Error("Build failed — fix errors before publishing");

  console.log(`Publishing ${pkgName} to Artifact Registry...`);
  rc = runInherit("mvn", ["deploy", "-DskipTests"], { cwd: pkgDir });
  if (rc !== 0) throw new Error("Publish failed");

  console.log(`Published ${pkgName} to GCP Artifact Registry`);
  console.log(`  Registry: ${REGISTRIES.maven.url}`);
}

async function publishPython(
  root: string,
  pkgDir: string,
  pkgName: string,
  keyFile?: string
): Promise<void> {
  const saJson = await loadSaJson("python", root, keyFile);
  if (!saJson) {
    throw new Error(
      "No Python registry credentials found.\n" +
        "Run 'dx pkg auth' to configure."
    );
  }

  // Determine build tool
  const hasUv = existsSync(join(pkgDir, "uv.lock"));

  console.log(`Building ${pkgName}...`);
  let rc: number;
  if (hasUv) {
    rc = runInherit("uv", ["build"], { cwd: pkgDir });
  } else {
    rc = runInherit("python", ["-m", "build"], { cwd: pkgDir });
  }
  if (rc !== 0) throw new Error("Build failed — fix errors before publishing");

  const repoUrl = pythonRepositoryUrl();
  const twineEnv = pythonTwineEnv(saJson);

  const distDir = join(pkgDir, "dist");
  if (!existsSync(distDir)) {
    throw new Error("No distribution files found in dist/");
  }
  const distFiles = readdirSync(distDir).map((f) => join(distDir, f));
  if (distFiles.length === 0) {
    throw new Error("No distribution files found in dist/");
  }

  console.log(`Publishing ${pkgName} to Python Artifact Registry...`);
  rc = runInherit(
    "twine",
    ["upload", "--repository-url", repoUrl, ...distFiles],
    { cwd: pkgDir, env: twineEnv }
  );
  if (rc !== 0) throw new Error("Publish failed");

  console.log(`Published ${pkgName} to Python Artifact Registry`);
  console.log(`  Registry: ${repoUrl}`);
}
