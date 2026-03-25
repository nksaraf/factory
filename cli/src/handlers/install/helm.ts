import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runOrThrow, run } from "../../lib/subprocess.js";
import { configToHelmValues, helmValuesToSetArgs } from "../../lib/site-config.js";
import { K3S_KUBECONFIG } from "./k3s.js";
import type { DxConfig } from "../../config.js";
import type { InstallRole } from "@smp/factory-shared/install-types";

const DX_NAMESPACE = "dx-system";
const RELEASE_NAME = "dx-platform";

export interface HelmInstallOptions {
  config: DxConfig;
  bundlePath?: string;
  chartVersion?: string;
  registryUrl?: string;
  verbose?: boolean;
}

/** Phase 4: Helm install dx-platform chart with role-aware values. */
export async function helmInstall(opts: HelmInstallOptions): Promise<string> {
  const values = configToHelmValues(opts.config);
  const setArgs = helmValuesToSetArgs(values);

  // Ensure namespace exists
  run("kubectl", [
    "create", "namespace", DX_NAMESPACE,
    "--kubeconfig", K3S_KUBECONFIG,
    "--dry-run=client", "-o", "yaml",
  ]);
  run("kubectl", [
    "apply", "-f", "-",
    "--kubeconfig", K3S_KUBECONFIG,
  ]);

  // Actually create namespace
  runOrThrow("kubectl", [
    "create", "namespace", DX_NAMESPACE,
    "--kubeconfig", K3S_KUBECONFIG,
  ]);

  const baseArgs = [
    "install", RELEASE_NAME,
    "--namespace", DX_NAMESPACE,
    "--kubeconfig", K3S_KUBECONFIG,
    "--wait",
    "--timeout", "10m",
    ...setArgs,
  ];

  let chartRef: string;
  if (opts.bundlePath) {
    // Offline: use chart from bundle
    const chartGlob = join(opts.bundlePath, "charts", `dx-platform-*.tgz`);
    chartRef = chartGlob;
    console.log(`Installing dx-platform from offline chart: ${chartRef}`);
  } else {
    // Connected: use OCI registry
    const registry = opts.registryUrl ?? "oci://registry.dx.dev/charts";
    chartRef = `${registry}/dx-platform`;
    if (opts.chartVersion) {
      baseArgs.push("--version", opts.chartVersion);
    }
    console.log(`Installing dx-platform from ${chartRef}`);
  }

  runOrThrow("helm", [baseArgs[0], baseArgs[1], chartRef, ...baseArgs.slice(2)], {
    verbose: opts.verbose,
  });

  // Wait for pods to be ready
  await waitForPods(opts.config.role as InstallRole, opts.verbose);

  const version = opts.chartVersion ?? "latest";
  console.log(`dx-platform ${version} installed in ${DX_NAMESPACE}.`);
  return version;
}

export async function helmUpgrade(opts: HelmInstallOptions): Promise<string> {
  const values = configToHelmValues(opts.config);
  const setArgs = helmValuesToSetArgs(values);

  const baseArgs = [
    "upgrade", RELEASE_NAME,
    "--namespace", DX_NAMESPACE,
    "--kubeconfig", K3S_KUBECONFIG,
    "--wait",
    "--timeout", "10m",
    "--reuse-values",
    ...setArgs,
  ];

  let chartRef: string;
  if (opts.bundlePath) {
    chartRef = join(opts.bundlePath, "charts", "dx-platform-*.tgz");
  } else {
    const registry = opts.registryUrl ?? "oci://registry.dx.dev/charts";
    chartRef = `${registry}/dx-platform`;
    if (opts.chartVersion) {
      baseArgs.push("--version", opts.chartVersion);
    }
  }

  console.log(`Upgrading dx-platform...`);
  runOrThrow("helm", [baseArgs[0], baseArgs[1], chartRef, ...baseArgs.slice(2)], {
    verbose: opts.verbose,
  });

  const version = opts.chartVersion ?? "latest";
  console.log(`dx-platform upgraded to ${version}.`);
  return version;
}

async function waitForPods(role: string, verbose?: boolean, timeoutMs = 300_000): Promise<void> {
  console.log("Waiting for dx-system pods...");
  const start = Date.now();
  let delay = 2000;

  while (Date.now() - start < timeoutMs) {
    const result = run("kubectl", [
      "get", "pods", "-n", DX_NAMESPACE,
      "--kubeconfig", K3S_KUBECONFIG,
      "-o", "jsonpath={.items[*].status.phase}",
    ]);

    if (result.status === 0 && result.stdout.length > 0) {
      const phases = result.stdout.split(" ");
      const allRunning = phases.length > 0 && phases.every((p) => p === "Running" || p === "Succeeded");
      if (allRunning) {
        console.log("All dx-system pods are running.");
        return;
      }
    }

    if (verbose) {
      console.error(`Pods not all ready, retrying in ${delay / 1000}s...`);
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 15_000);
  }

  throw new Error(`dx-system pods not ready after ${timeoutMs / 1000}s`);
}

export { DX_NAMESPACE, RELEASE_NAME };
