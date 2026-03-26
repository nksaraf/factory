import { existsSync, copyFileSync, chmodSync } from "node:fs";
import { run, runOrThrow, runInherit } from "../../lib/subprocess.js";

const K3S_BIN = "/usr/local/bin/k3s";
const DEFAULT_KUBECONFIG = "/etc/rancher/k3s/k3s.yaml";
const NODE_TOKEN_PATH = "/var/lib/rancher/k3s/server/node-token";

let _kubeconfigPath = DEFAULT_KUBECONFIG;

/** Get the active kubeconfig path. */
export function getKubeconfig(): string {
  return _kubeconfigPath;
}

/** Override the kubeconfig path (e.g. for a remote cluster). */
export function setKubeconfig(path: string): void {
  _kubeconfigPath = path;
}

export interface K3sBootstrapOptions {
  /** Path to offline bundle directory (contains k3s binary). */
  bundlePath?: string;
  verbose?: boolean;
  /** Only wait for API + read token; skip install (resume after phase 2). */
  skipInstall?: boolean;
}

/** Phase 2: Install k3s server and wait for API readiness. */
export async function bootstrapK3s(opts: K3sBootstrapOptions): Promise<{ joinToken: string }> {
  if (!opts.skipInstall) {
    if (opts.bundlePath) {
      installK3sOffline(opts.bundlePath, opts.verbose);
    } else {
      installK3sOnline(opts.verbose);
    }
  } else {
    console.log("Using existing k3s installation (resume).");
  }

  await waitForK3sReady(opts.verbose);

  const tokenResult = run("cat", [NODE_TOKEN_PATH]);
  if (tokenResult.status !== 0) {
    throw new Error("Failed to read k3s join token");
  }

  return { joinToken: tokenResult.stdout.trim() };
}

function installK3sOffline(bundlePath: string, verbose?: boolean): void {
  const binarySource = `${bundlePath}/k3s`;
  if (!existsSync(binarySource)) {
    throw new Error(`k3s binary not found in bundle: ${binarySource}`);
  }

  console.log("Installing k3s from offline bundle...");
  copyFileSync(binarySource, K3S_BIN);
  chmodSync(K3S_BIN, 0o755);

  // Create systemd unit and start
  const exitCode = runInherit(K3S_BIN, [
    "server",
    "--disable=traefik",
    "--write-kubeconfig-mode=0644",
  ], { verbose });

  if (exitCode !== 0) {
    throw new Error("k3s server failed to start");
  }
}

function installK3sOnline(verbose?: boolean): void {
  console.log("Installing k3s from official install script...");

  // Download and run official installer
  const curl = run("curl", ["-sfL", "https://get.k3s.io"], { verbose });
  if (curl.status !== 0) {
    throw new Error("Failed to download k3s install script");
  }

  const exitCode = runInherit("sh", ["-c", curl.stdout], {
    env: {
      INSTALL_K3S_EXEC: "server --disable=traefik --write-kubeconfig-mode=0644",
    },
    verbose,
  });

  if (exitCode !== 0) {
    throw new Error("k3s installation script failed");
  }
}

async function waitForK3sReady(verbose?: boolean, timeoutMs = 120_000): Promise<void> {
  console.log("Waiting for k3s API server...");
  const start = Date.now();
  let delay = 1000;

  while (Date.now() - start < timeoutMs) {
    const result = run("kubectl", ["get", "nodes", "--kubeconfig", getKubeconfig()]);
    if (result.status === 0 && result.stdout.includes("Ready")) {
      console.log("k3s API server is ready.");
      return;
    }
    if (verbose) {
      console.error(`k3s not ready yet, retrying in ${delay / 1000}s...`);
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 10_000);
  }

  throw new Error(`k3s API server not ready after ${timeoutMs / 1000}s`);
}

export function getK3sVersion(): string {
  const result = run(K3S_BIN, ["--version"]);
  if (result.status !== 0) return "unknown";
  // Output: "k3s version v1.28.5+k3s1 (abc123)"
  const match = result.stdout.match(/v[\d.]+\+k3s\d+/);
  return match ? match[0] : result.stdout.trim().split(" ")[2] ?? "unknown";
}

export { DEFAULT_KUBECONFIG as K3S_KUBECONFIG };
