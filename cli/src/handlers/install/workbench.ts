/**
 * dx install (workbench role) — full developer workbench setup.
 *
 * Phases:
 *   1. Identity — generate workbenchId, detect type
 *   2. Toolchain — parallel checks for required dev tools
 *   3. Factory auth — check / prompt for dx auth login
 *   4. Pkg auth — check / prompt for registry credentials
 *   5. Corepack — enable if installed but not active
 *   6. Docker — check docker + compose availability
 *   7. Save — persist .dx/workbench.json + global config
 *   8. Register — POST to factory if authenticated
 */

import ora from "ora";
import { select, input } from "@inquirer/prompts";
import { styleSuccess, styleMuted } from "../../cli-style.js";
import { run } from "../../lib/subprocess.js";
import { printToolchainResults } from "../../lib/cli-ui.js";
import {
  createWorkbenchConfig,
  readWorkbenchConfig,
  writeWorkbenchConfig,
  resolveWorkbenchRoot,
} from "./workbench-identity.js";
import { runToolchainChecks, getMissingToolInstallCommands, installTool } from "./toolchain.js";
import { getStoredBearerToken } from "../../session-token.js";
import { registryAuthStore } from "../pkg/registry-auth-store.js";
import { dxConfigStore } from "../../config.js";
import type { WorkbenchType } from "@smp/factory-shared/install-types";

const DX_VERSION = process.env.DX_VERSION ?? "0.0.0-dev";

export interface WorkbenchSetupOpts {
  factoryUrl?: string;
  dir?: string;
  type?: string;
  yes?: boolean;
  verbose?: boolean;
  registryKey?: string;
  registryKeyFile?: string;
}

export interface WorkbenchResult {
  workbenchId: string;
  type: WorkbenchType;
  root: string;
  factoryUrl?: string;
  user?: string;
  context?: string;
  toolchainPassed: boolean;
  dockerAvailable: boolean;
  registered: boolean;
}

export async function runWorkbenchSetup(opts: WorkbenchSetupOpts): Promise<WorkbenchResult> {
  const root = resolveWorkbenchRoot(opts.dir);
  const existing = readWorkbenchConfig(root);

  // --- Phase 1: Identity ---
  const config = existing
    ? { ...existing, lastInstallAt: new Date().toISOString(), dxVersion: DX_VERSION }
    : createWorkbenchConfig({
        root,
        type: opts.type,
        dxVersion: DX_VERSION,
        factoryUrl: opts.factoryUrl,
      });

  // Override type if explicitly set
  if (opts.type) {
    const { detectWorkbenchType } = await import("./workbench-identity.js");
    config.type = detectWorkbenchType(opts.type);
  }

  if (opts.factoryUrl) {
    config.factoryUrl = opts.factoryUrl;
  }

  console.log(`  ${styleMuted(`Workbench ${config.workbenchId} (${config.type})`)}`);
  console.log();

  // --- Phase 2: Toolchain ---
  const toolSpinner = ora({ text: "Checking toolchain...", prefixText: " " }).start();
  let toolchain = await runToolchainChecks();
  toolSpinner.stop();

  printToolchainResults(toolchain.checks);
  console.log();

  // Record discovered versions
  for (const check of toolchain.checks) {
    if (check.version) {
      config.toolchainVersions[check.name] = check.version;
    }
  }

  if (!toolchain.passed) {
    const missingInstalls = getMissingToolInstallCommands(toolchain.checks);

    if (!opts.yes && missingInstalls.length > 0) {
      console.log(`  ${styleMuted("Missing tools can be auto-installed:")}`);
      for (const m of missingInstalls) {
        console.log(`    ${m.name}: ${styleMuted(m.command)}`);
      }
      console.log();

      const action = await select({
        message: "How would you like to proceed?",
        choices: [
          { value: "install", name: "Install missing tools now" },
          { value: "continue", name: "Continue without installing" },
          { value: "abort", name: "Abort" },
        ],
        default: "install",
      });

      if (action === "abort") {
        throw new Error("Workbench setup aborted — install missing tools and retry.");
      }

      if (action === "install") {
        for (const m of missingInstalls) {
          const installSpinner = ora({ text: `Installing ${m.name}...`, prefixText: " " }).start();
          const ok = await installTool(m.name);
          if (ok) {
            installSpinner.succeed(`Installed ${m.name}`);
          } else {
            installSpinner.fail(`Failed to install ${m.name} — run manually: ${m.command}`);
          }
        }
        // Re-check toolchain after installs
        console.log();
        const recheck = ora({ text: "Re-checking toolchain...", prefixText: " " }).start();
        const recheckResult = await runToolchainChecks();
        recheck.stop();
        printToolchainResults(recheckResult.checks);
        console.log();
        // Update versions from recheck
        for (const check of recheckResult.checks) {
          if (check.version) {
            config.toolchainVersions[check.name] = check.version;
          }
        }
        toolchain = recheckResult;
      }
    } else if (opts.yes) {
      // In --yes mode, log the install commands for reference but continue
      if (missingInstalls.length > 0) {
        console.log(`  ${styleMuted("Missing tools (install manually):")}`);
        for (const m of missingInstalls) {
          console.log(`    ${m.name}: ${styleMuted(m.command)}`);
        }
        console.log();
      }
    }
  }

  // --- Phase 3: Factory connection + auth ---
  // Prompt for factory mode if not already configured
  if (!config.factoryUrl && !opts.yes) {
    const factoryMode = await select({
      message: "How would you like to use dx?",
      choices: [
        { value: "local", name: "Local factory (default) — runs a local API on this machine" },
        { value: "cloud", name: "Cloud factory — connect to factory.rio.software" },
        { value: "custom", name: "Other factory — enter a custom factory URL" },
      ],
      default: "local",
    });

    if (factoryMode === "local") {
      config.factoryUrl = "http://localhost:4100";
      config.installMode = "local";
      // Check Docker availability (required for k3d)
      const dockerCheck = run("docker", ["info", "--format", "{{.ServerVersion}}"]);
      if (dockerCheck.status !== 0) {
        console.log(`  ${styleMuted("Docker is required for local clusters. Install and start Docker, then run: dx cluster create --local")}`);
      } else {
        console.log(`  ${styleSuccess("✔")} Docker available — run ${styleMuted("dx cluster create --local")} to create a local k3d cluster`);
      }
    } else if (factoryMode === "cloud") {
      config.factoryUrl = "https://factory.rio.software";
    } else {
      const url = await input({
        message: "Factory URL:",
        validate: (v) => {
          try {
            new URL(v);
            return true;
          } catch {
            return "Enter a valid URL";
          }
        },
      });
      config.factoryUrl = url.replace(/\/$/, "");
    }
  } else if (!config.factoryUrl && opts.yes) {
    // Non-interactive: default to local factory
    config.factoryUrl = "http://localhost:4100";
    config.installMode = "local";
  }

  let authenticated = false;
  const isLocalMode = config.factoryUrl === "http://localhost:4100";

  if (isLocalMode) {
    // Local mode: no auth required
    console.log(`  ${styleSuccess("✔")} Local factory mode — no authentication required`);
    authenticated = true;
  } else {
    const authSpinner = ora({ text: "Checking authentication...", prefixText: " " }).start();
    try {
      const token = await getStoredBearerToken();
      if (token) {
        authSpinner.succeed("Authenticated");
        authenticated = true;
      } else {
        authSpinner.warn("Not authenticated");
        if (!opts.yes) {
          const doAuth = await select({
            message: "Set up factory authentication?",
            choices: [
              { value: true, name: "Yes, run dx auth login" },
              { value: false, name: "Skip (can run dx auth login later)" },
            ],
            default: true,
          });
          if (doAuth) {
            try {
              const { runAuthLogin } = await import("../auth-login.js");
              await runAuthLogin({ json: false, verbose: opts.verbose, debug: false }, {});
              const postToken = await getStoredBearerToken();
              authenticated = !!postToken;
            } catch {
              console.log(`  ${styleMuted("Auth setup failed — run dx auth login later")}`);
            }
          }
        }
      }
    } catch {
      authSpinner.warn("Auth check failed — run dx auth login later");
    }
  }

  // --- Phase 4: Pkg auth ---
  const pkgSpinner = ora({ text: "Checking registry credentials...", prefixText: " " }).start();
  try {
    const stored = await registryAuthStore.read();
    const hasKey =
      stored.GOOGLE_APPLICATION_CREDENTIALS_BASE64.length > 0 ||
      stored.GCP_NPM_SA_JSON_BASE64.length > 0;

    if (hasKey) {
      pkgSpinner.succeed("Registry credentials configured");
      // Re-authenticate registries from existing credentials (refreshes tokens)
      try {
        await runPkgAuthInline(stored, root);
      } catch {
        // Non-fatal — credentials are stored, auth refresh failed
      }
    } else {
      // Check for credentials from flags or env vars
      const registryKeyB64 =
        opts.registryKey ||
        process.env.DX_REGISTRY_KEY ||
        process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;
      const registryKeyFile =
        opts.registryKeyFile ||
        process.env.DX_REGISTRY_KEY_FILE ||
        process.env.GOOGLE_APPLICATION_CREDENTIALS;

      if (registryKeyB64 || registryKeyFile) {
        pkgSpinner.text = "Configuring registry credentials...";
        try {
          const { pkgAuth } = await import("../pkg/auth.js");
          if (registryKeyFile) {
            await pkgAuth(root, { keyFile: registryKeyFile });
          } else {
            await pkgAuth(root, { key: registryKeyB64 });
          }
          pkgSpinner.succeed("Registry credentials configured");
        } catch (err) {
          pkgSpinner.fail(`Registry auth failed: ${err instanceof Error ? err.message : err}`);
        }
      } else if (!opts.yes) {
        pkgSpinner.warn("No registry credentials");
        const doPkgAuth = await select({
          message: "Set up package registry authentication?",
          choices: [
            { value: true, name: "Yes, configure now" },
            { value: false, name: "Skip (can run dx pkg auth later)" },
          ],
          default: true,
        });
        if (doPkgAuth) {
          const keySource = await select({
            message: "How would you like to provide the GCP service account key?",
            choices: [
              { value: "file", name: "Path to JSON key file" },
              { value: "base64", name: "Base64-encoded key" },
            ],
          });
          try {
            const { pkgAuth } = await import("../pkg/auth.js");
            if (keySource === "file") {
              const { existsSync } = await import("node:fs");
              const keyFilePath = await input({
                message: "Path to key file:",
                validate: (v) => {
                  if (!v.trim()) return "Path is required";
                  if (!existsSync(v.trim())) return `File not found: ${v}`;
                  return true;
                },
              });
              await pkgAuth(root, { keyFile: keyFilePath.trim() });
            } else {
              const keyB64 = await input({
                message: "Base64-encoded key:",
                validate: (v) => v.trim() ? true : "Key is required",
              });
              await pkgAuth(root, { key: keyB64.trim() });
            }
          } catch (err) {
            console.log(`  ${styleMuted(`Registry auth failed: ${err instanceof Error ? err.message : err}`)}`);
            console.log(`  ${styleMuted("Run dx pkg auth --key-file <path> later to retry")}`);
          }
        }
      } else {
        pkgSpinner.warn("No registry credentials (pass --registry-key or --registry-key-file, or set DX_REGISTRY_KEY env var)");
      }
    }
  } catch {
    pkgSpinner.warn("Registry credential check failed");
  }

  // --- Phase 5: Corepack ---
  if (config.toolchainVersions.corepack) {
    const corepackResult = run("corepack", ["enable"]);
    if (corepackResult.status === 0) {
      console.log(`  ${styleSuccess("✔")} corepack enabled`);
    }
  }

  // --- Phase 6: Docker ---
  let dockerAvailable = false;
  const dockerResult = run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  if (dockerResult.status === 0) {
    const dockerVersion = dockerResult.stdout.trim();
    const composeResult = run("docker", ["compose", "version", "--short"]);
    const composeVersion = composeResult.status === 0 ? composeResult.stdout.trim() : "not found";
    console.log(`  ${styleSuccess("✔")} Docker ${dockerVersion}  Compose ${composeVersion}`);
    dockerAvailable = true;
  } else {
    console.log(`  ${styleMuted("Docker not running — optional, needed for dx dev")}`);
  }

  // --- Phase 7: Save ---
  writeWorkbenchConfig(root, config);

  // Persist factoryUrl to global config so getFactoryClient() picks it up
  if (config.factoryUrl) {
    await dxConfigStore.update((prev) => ({
      ...prev,
      factoryUrl: config.factoryUrl!,
      installMode: isLocalMode ? "local" : prev.installMode,
    }));
  }

  // --- Phase 8: Factory registration ---
  let registered = config.factoryRegistered;
  if (authenticated && config.factoryUrl) {
    try {
      const token = await getStoredBearerToken();
      if (token) {
        const url = `${config.factoryUrl.replace(/\/$/, "")}/api/v1/factory/fleet/workbenches`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workbenchId: config.workbenchId,
            type: config.type,
            hostname: config.hostname,
            ips: config.ips,
            os: config.os,
            arch: config.arch,
            dxVersion: DX_VERSION,
          }),
        });
        if (res.ok) {
          config.factoryRegistered = true;
          config.registeredAt = new Date().toISOString();
          writeWorkbenchConfig(root, config);
          registered = true;
        }
      }
    } catch {
      // Registration is best-effort
    }
  }

  return {
    workbenchId: config.workbenchId,
    type: config.type,
    root,
    factoryUrl: config.factoryUrl,
    user: authenticated ? "authenticated" : undefined,
    toolchainPassed: toolchain.passed,
    dockerAvailable,
    registered,
  };
}

/**
 * Run pkg auth inline using stored credentials.
 * For npm, we need a temp directory with an .npmrc pointing to the Artifact Registry
 * since there's no project context during workbench install.
 */
async function runPkgAuthInline(
  stored: Awaited<ReturnType<typeof registryAuthStore.read>>,
  _root: string,
): Promise<void> {
  const { decodeSaBase64, configureMavenAuth, configureNpmAuth, configureDockerAuth, gcloudAvailable, REGISTRIES } =
    await import("../pkg/registry.js");

  const b64 =
    stored.GOOGLE_APPLICATION_CREDENTIALS_BASE64 ||
    stored.GCP_NPM_SA_JSON_BASE64 ||
    stored.GCP_MAVEN_SA_JSON_BASE64;

  if (!b64) return;

  const saJson = decodeSaBase64(b64);
  if (!saJson) return;

  // Maven auth
  configureMavenAuth(saJson);

  // npm auth — needs a temp dir with .npmrc pointing to the registry
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const tmpDir = mkdtempSync(join(tmpdir(), "dx-npm-auth-"));
  try {
    const npmrcContent = [
      `@lepton:registry=https://${REGISTRIES.npm.url}`,
      `@rio.js:registry=https://${REGISTRIES.npm.url}`,
      `registry=https://registry.npmjs.org`,
      `//${REGISTRIES.npm.url}:always-auth=true`,
    ].join("\n");
    writeFileSync(join(tmpDir, ".npmrc"), npmrcContent);
    configureNpmAuth(saJson, tmpDir);
  } finally {
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  }

  // Docker auth — requires gcloud
  if (gcloudAvailable()) {
    configureDockerAuth(saJson);
  }
}
