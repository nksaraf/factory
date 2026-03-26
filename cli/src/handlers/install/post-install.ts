import { run, runOrThrow } from "../../lib/subprocess.js";
import { planesForRole, type InstallManifest, type InstallRole } from "@smp/factory-shared/install-types";
import { getK3sVersion, getKubeconfig } from "./k3s.js";
import { DX_NAMESPACE } from "./helm.js";
import type { DxConfig } from "../../config.js";

export interface PostInstallOptions {
  config: DxConfig;
  helmChartVersion: string;
  dxVersion: string;
  verbose?: boolean;
}

/** Phase 5: Post-install setup — admin user, install manifest, Factory registration. */
export async function runPostInstall(opts: PostInstallOptions): Promise<InstallManifest> {
  const { config } = opts;
  const apiBase = `https://${config.domain}`;

  // Wait for dx-api health
  await waitForApiHealth(apiBase, opts.verbose);

  // Create admin user
  await createAdminUser(apiBase, config.adminEmail, opts.verbose);

  // Build and write install manifest
  const manifest = buildManifest(opts);
  await writeManifestConfigMap(manifest, opts.verbose);

  // Connected site: register with Factory
  if (config.installMode === "connected" && config.factoryUrl) {
    await registerWithFactory(config.factoryUrl, config.siteName, manifest, opts.verbose);
  }

  // Factory self-bootstrap: create self-referencing site record
  if (config.role === "factory" && !config.factoryUrl) {
    console.log("Factory self-bootstrap: creating self-referencing site record...");
    // The Factory API is now running locally — register this install as the Factory site
    await registerWithFactory(apiBase, config.siteName, manifest, opts.verbose);
  }

  return manifest;
}

async function waitForApiHealth(apiBase: string, verbose?: boolean, timeoutMs = 120_000): Promise<void> {
  console.log("Waiting for dx-api health...");
  const start = Date.now();
  let delay = 2000;

  while (Date.now() - start < timeoutMs) {
    const result = run("curl", ["-sf", `${apiBase}/health`, "--max-time", "5"]);
    if (result.status === 0) {
      console.log("dx-api is healthy.");
      return;
    }
    if (verbose) {
      console.error(`dx-api not ready, retrying in ${delay / 1000}s...`);
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 10_000);
  }

  throw new Error(`dx-api not healthy after ${timeoutMs / 1000}s`);
}

async function createAdminUser(apiBase: string, email: string, verbose?: boolean): Promise<void> {
  console.log(`Creating admin user: ${email}`);
  const result = run("curl", [
    "-sf", "-X", "POST",
    `${apiBase}/api/v1/auth/signup`,
    "-H", "Content-Type: application/json",
    "-d", JSON.stringify({ email, role: "admin" }),
    "--max-time", "10",
  ]);

  if (result.status !== 0) {
    // Non-fatal: admin may already exist from a previous install attempt
    console.warn("Admin user creation returned non-zero (may already exist).");
    if (verbose) console.error(result.stderr);
  }
}

function buildManifest(opts: PostInstallOptions): InstallManifest {
  const { config } = opts;

  // Detect current node info
  const hostnameResult = run("hostname", []);
  const hostname = hostnameResult.stdout.trim() || "unknown";

  const ipResult = run("hostname", ["-I"]);
  const ip = ipResult.stdout.trim().split(" ")[0] ?? "unknown";

  return {
    version: 1,
    role: config.role as InstallRole,
    installedAt: new Date().toISOString(),
    dxVersion: opts.dxVersion,
    installMode: config.installMode as "connected" | "offline",
    k3sVersion: getK3sVersion(),
    helmChartVersion: opts.helmChartVersion,
    siteName: config.siteName,
    domain: config.domain,
    enabledPlanes: planesForRole(config.role as InstallRole),
    nodes: [
      {
        name: hostname,
        role: "server",
        joinedAt: new Date().toISOString(),
        ip,
      },
    ],
    upgrades: [],
  };
}

async function writeManifestConfigMap(manifest: InstallManifest, verbose?: boolean): Promise<void> {
  console.log("Writing install manifest ConfigMap...");

  const configMapJson = JSON.stringify({
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: "dx-install-manifest",
      namespace: DX_NAMESPACE,
    },
    data: {
      "manifest.json": JSON.stringify(manifest, null, 2),
    },
  });

  const result = run("kubectl", [
    "apply", "-f", "-",
    "--kubeconfig", getKubeconfig(),
  ]);

  // kubectl apply reads from stdin — use a different approach
  const { spawnSync } = await import("node:child_process");
  const proc = spawnSync("kubectl", [
    "apply", "-f", "-",
    "--kubeconfig", getKubeconfig(),
  ], {
    input: configMapJson,
    encoding: "utf8",
  });

  if (proc.status !== 0) {
    throw new Error(`Failed to write install manifest: ${proc.stderr}`);
  }

  console.log("Install manifest written.");
}

async function registerWithFactory(
  factoryUrl: string,
  siteName: string,
  manifest: InstallManifest,
  verbose?: boolean
): Promise<void> {
  console.log(`Registering with Factory at ${factoryUrl}...`);
  const result = run("curl", [
    "-sf", "-X", "POST",
    `${factoryUrl}/api/v1/factory/fleet/sites/${siteName}/install-manifest`,
    "-H", "Content-Type: application/json",
    "-d", JSON.stringify(manifest),
    "--max-time", "15",
  ]);

  if (result.status !== 0) {
    console.warn("Factory registration failed (non-fatal, will retry on next heartbeat).");
    if (verbose) console.error(result.stderr);
  } else {
    console.log("Registered with Factory.");
  }
}
