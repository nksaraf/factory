import { existsSync, copyFileSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { run, runOrThrow, runInherit } from "../../lib/subprocess.js";
import { getKubeconfig, getK3sVersion } from "./k3s.js";
import { DX_NAMESPACE } from "./helm.js";
import { loadImages } from "./images.js";
import type { InstallManifest } from "@smp/factory-shared/install-types";

export interface JoinOptions {
  server: string;
  token: string;
  bundlePath?: string;
  verbose?: boolean;
}

/** dx setup join — join this node to an existing cluster as an agent. */
export async function runJoin(opts: JoinOptions): Promise<void> {
  // 1. Preflight: basic checks
  console.log("--- Preflight ---");
  if (process.getuid?.() !== 0) {
    throw new Error("Must run as root (use sudo)");
  }

  // 2. Install k3s in agent mode
  console.log("\n--- Installing k3s agent ---");
  if (opts.bundlePath) {
    const binarySource = `${opts.bundlePath}/k3s`;
    if (!existsSync(binarySource)) {
      throw new Error(`k3s binary not found in bundle: ${binarySource}`);
    }
    copyFileSync(binarySource, "/usr/local/bin/k3s");
    chmodSync("/usr/local/bin/k3s", 0o755);
  }

  const exitCode = runInherit("sh", ["-c", "curl -sfL https://get.k3s.io | sh -"], {
    env: {
      K3S_URL: opts.server,
      K3S_TOKEN: opts.token,
      INSTALL_K3S_EXEC: "agent",
    },
    verbose: opts.verbose,
  });

  if (exitCode !== 0 && !opts.bundlePath) {
    throw new Error("k3s agent installation failed");
  }

  // For offline, start k3s agent directly
  if (opts.bundlePath) {
    const agentExit = runInherit("/usr/local/bin/k3s", ["agent"], {
      env: {
        K3S_URL: opts.server,
        K3S_TOKEN: opts.token,
      },
      verbose: opts.verbose,
    });
  }

  // 3. Load images (agent set)
  if (opts.bundlePath) {
    console.log("\n--- Loading images ---");
    loadImages({
      role: "site", // Agent nodes get site-level images
      bundlePath: opts.bundlePath,
      verbose: opts.verbose,
    });
  }

  // 4. Wait for node to appear in cluster
  console.log("\n--- Waiting for node to join cluster ---");
  await waitForNodeJoin(opts.verbose);

  // 5. Update manifest ConfigMap
  console.log("\n--- Updating install manifest ---");
  await appendNodeToManifest(opts.server, opts.verbose);

  console.log("\nNode successfully joined the cluster.");
}

async function waitForNodeJoin(verbose?: boolean, timeoutMs = 120_000): Promise<void> {
  const hostname = run("hostname", []).stdout.trim();
  const start = Date.now();
  let delay = 2000;

  while (Date.now() - start < timeoutMs) {
    const result = run("kubectl", [
      "get", "node", hostname,
      "--kubeconfig", getKubeconfig(),
      "-o", "jsonpath={.status.conditions[?(@.type=='Ready')].status}",
    ]);

    if (result.status === 0 && result.stdout.includes("True")) {
      console.log(`Node ${hostname} is Ready.`);
      return;
    }

    if (verbose) {
      console.error(`Node not ready yet, retrying in ${delay / 1000}s...`);
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 10_000);
  }

  throw new Error(`Node did not become Ready after ${timeoutMs / 1000}s`);
}

async function appendNodeToManifest(server: string, verbose?: boolean): Promise<void> {
  const proc = spawnSync("kubectl", [
    "get", "configmap", "dx-install-manifest",
    "-n", DX_NAMESPACE,
    "--kubeconfig", getKubeconfig(),
    "-o", "jsonpath={.data.manifest\\.json}",
  ], { encoding: "utf8" });

  if (proc.status !== 0) {
    console.warn("Could not read install manifest to update (non-fatal).");
    return;
  }

  const manifest: InstallManifest = JSON.parse(proc.stdout);
  const hostname = run("hostname", []).stdout.trim();
  const ipResult = run("hostname", ["-I"]);
  const ip = ipResult.stdout.trim().split(" ")[0] ?? "unknown";

  manifest.nodes.push({
    name: hostname,
    role: "agent",
    joinedAt: new Date().toISOString(),
    ip,
  });

  const configMapJson = JSON.stringify({
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: "dx-install-manifest", namespace: DX_NAMESPACE },
    data: { "manifest.json": JSON.stringify(manifest, null, 2) },
  });

  spawnSync("kubectl", [
    "apply", "-f", "-",
    "--kubeconfig", getKubeconfig(),
  ], { input: configMapJson, encoding: "utf8" });
}
