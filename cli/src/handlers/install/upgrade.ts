import { spawnSync } from "node:child_process";
import { run, runOrThrow } from "../../lib/subprocess.js";
import { loadSiteConfig } from "../../lib/site-config.js";
import { K3S_KUBECONFIG } from "./k3s.js";
import { DX_NAMESPACE, helmUpgrade } from "./helm.js";
import { loadImages } from "./images.js";
import { verifyHealth } from "./health.js";
import type { InstallManifest, InstallRole } from "@smp/factory-shared/install-types";

export interface UpgradeOptions {
  bundlePath?: string;
  configPath?: string;
  version?: string;
  verbose?: boolean;
}

/** Read the current install manifest from the cluster. */
function readCurrentManifest(): InstallManifest {
  const proc = spawnSync("kubectl", [
    "get", "configmap", "dx-install-manifest",
    "-n", DX_NAMESPACE,
    "--kubeconfig", K3S_KUBECONFIG,
    "-o", "jsonpath={.data.manifest\\.json}",
  ], { encoding: "utf8" });

  if (proc.status !== 0) {
    throw new Error("No install manifest found — is dx-platform installed?");
  }

  return JSON.parse(proc.stdout) as InstallManifest;
}

/** dx install upgrade — orchestrates phases 3-6 with role awareness. */
export async function runUpgrade(opts: UpgradeOptions): Promise<void> {
  // 1. Read current manifest to get role and version
  const manifest = readCurrentManifest();
  const role: InstallRole = manifest.role;
  console.log(`Current install: v${manifest.dxVersion} (${role})`);

  // 2. Load config (for Helm values)
  const config = loadSiteConfig(opts.configPath);

  // Ensure role hasn't changed
  if (config.role !== role) {
    throw new Error(
      `Cannot change role during upgrade (current: ${role}, config: ${config.role}). ` +
      `Role is set at install time and persists across upgrades.`
    );
  }

  // 3. Load new images (Phase 3)
  console.log("\n--- Phase 3: Loading images ---");
  loadImages({
    role,
    bundlePath: opts.bundlePath,
    verbose: opts.verbose,
  });

  // 4. Helm upgrade (Phase 4)
  console.log("\n--- Phase 4: Upgrading platform ---");
  const chartVersion = await helmUpgrade({
    config,
    bundlePath: opts.bundlePath,
    chartVersion: opts.version,
    verbose: opts.verbose,
  });

  // 5. Wait for rollout
  console.log("\n--- Waiting for rollout ---");
  const rolloutResult = run("kubectl", [
    "rollout", "status",
    "deployment", "-n", DX_NAMESPACE,
    "--kubeconfig", K3S_KUBECONFIG,
    "--timeout=300s",
  ], { verbose: opts.verbose });

  if (rolloutResult.status !== 0) {
    console.error("Rollout did not complete. To rollback:");
    console.error(`  helm rollback ${DX_NAMESPACE} --kubeconfig ${K3S_KUBECONFIG}`);
    throw new Error("Upgrade rollout failed");
  }

  // 6. Update manifest with upgrade record
  manifest.upgrades.push({
    fromVersion: manifest.dxVersion,
    toVersion: chartVersion,
    upgradedAt: new Date().toISOString(),
  });
  manifest.dxVersion = chartVersion;
  manifest.helmChartVersion = chartVersion;

  const configMapJson = JSON.stringify({
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: "dx-install-manifest", namespace: DX_NAMESPACE },
    data: { "manifest.json": JSON.stringify(manifest, null, 2) },
  });

  spawnSync("kubectl", [
    "apply", "-f", "-",
    "--kubeconfig", K3S_KUBECONFIG,
  ], { input: configMapJson, encoding: "utf8" });

  // 7. Health verification (Phase 6)
  console.log("\n--- Phase 6: Health verification ---");
  const healthy = await verifyHealth({
    role,
    domain: manifest.domain,
    verbose: opts.verbose,
  });

  if (!healthy) {
    console.error("Health checks failed after upgrade. To rollback:");
    console.error(`  helm rollback dx-platform --kubeconfig ${K3S_KUBECONFIG}`);
    throw new Error("Post-upgrade health check failed");
  }

  console.log(`\nUpgrade to v${chartVersion} complete.`);
}
