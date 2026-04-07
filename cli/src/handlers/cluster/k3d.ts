/**
 * k3d cluster management — create, delete, list local k3d clusters.
 */

import { homedir } from "node:os"
import { join } from "node:path"
import { mkdirSync, writeFileSync } from "node:fs"

import { capture, captureOrThrow } from "../../lib/subprocess.js"

const DX_CONFIG_DIR = join(homedir(), ".config", "dx")

export interface K3dCreateOptions {
  /** Cluster name (default: "dx-local") */
  name?: string
  /** API server port on host (default: 6550) */
  apiPort?: number
  /** HTTP port mapping on host (default: 8080) */
  httpPort?: number
  /** HTTPS port mapping on host (default: 8443) */
  httpsPort?: number
  /** Start of NodePort range (default: 30000) */
  nodePortLo?: number
  /** End of NodePort range (default: 30200) */
  nodePortHi?: number
  /** Extra TLS SANs for the k3s API server certificate */
  tlsSans?: string[]
}

/**
 * Ensure k3d is installed; throw with install instructions if not.
 */
export async function ensureK3d(): Promise<void> {
  const result = await capture(["k3d", "version"])
  if (result.exitCode === 0) return

  // Try to install
  const platform = process.platform
  let installCmd: string[] | undefined
  if (platform === "darwin") {
    installCmd = ["sh", "-c", "brew install k3d"]
  } else if (platform === "linux") {
    installCmd = ["sh", "-c", "curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash"]
  } else if (platform === "win32") {
    installCmd = ["powershell", "-Command", "choco install k3d -y"]
  }

  if (installCmd) {
    console.log(`k3d not found. Attempting install...`)
    const installResult = await capture(installCmd)
    if (installResult.exitCode === 0) {
      console.log("k3d installed successfully.")
      return
    }
  }

  const instructions = [
    "k3d is required for local clusters. Install it:",
    "  macOS:  brew install k3d",
    "  Linux:  curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash",
    "  Windows: choco install k3d",
    "  Or visit: https://k3d.io",
  ]
  throw new Error(instructions.join("\n"))
}

/**
 * Create a k3d cluster with sensible defaults for local development.
 */
export async function createK3dCluster(opts: K3dCreateOptions = {}): Promise<{
  name: string
  kubeconfigPath: string
}> {
  await ensureK3d()

  const name = opts.name ?? "dx-local"
  const apiPort = opts.apiPort ?? 6550
  const httpPort = opts.httpPort ?? 8080
  const httpsPort = opts.httpsPort ?? 8443
  const nodePortLo = opts.nodePortLo ?? 30000
  const nodePortHi = opts.nodePortHi ?? 30200
  const tlsSans = opts.tlsSans ?? []

  // Check if cluster already exists
  const existing = await capture(["k3d", "cluster", "list", "--output", "json"])
  if (existing.exitCode === 0) {
    try {
      const clusters = JSON.parse(existing.stdout)
      if (Array.isArray(clusters) && clusters.some((c: any) => c.name === name)) {
        console.log(`Cluster '${name}' already exists.`)
        const kubeconfigPath = await getK3dKubeconfig(name)
        return { name, kubeconfigPath }
      }
    } catch {}
  }

  console.log(`Creating k3d cluster '${name}'...`)

  const nodePortRange = `${nodePortLo}-${nodePortHi}`
  const args = [
    "k3d", "cluster", "create", name,
    "--api-port", String(apiPort),
    "-p", `${httpPort}:80@loadbalancer`,
    "-p", `${httpsPort}:443@loadbalancer`,
    // Expose NodePort range for workspace services (SSH, web-terminal, web-ide)
    "-p", `${nodePortRange}:${nodePortRange}@server:0`,
    // Constrain k3s to only assign NodePorts in the mapped range
    "--k3s-arg", `--service-node-port-range=${nodePortRange}@server:0`,
    "--wait",
  ]

  // Add TLS SANs so containers (e.g. Docker-compose factory) can reach the API
  for (const san of tlsSans) {
    args.push("--k3s-arg", `--tls-san=${san}@server:0`)
  }

  // Always add host.docker.internal as a TLS SAN for Docker accessibility
  if (!tlsSans.includes("host.docker.internal")) {
    args.push("--k3s-arg", "--tls-san=host.docker.internal@server:0")
  }

  await captureOrThrow(args)

  console.log(`Cluster '${name}' created.`)
  const kubeconfigPath = await getK3dKubeconfig(name)
  return { name, kubeconfigPath }
}

/**
 * Delete a k3d cluster.
 */
export async function deleteK3dCluster(name: string): Promise<void> {
  await ensureK3d()
  console.log(`Deleting k3d cluster '${name}'...`)
  await captureOrThrow(["k3d", "cluster", "delete", name])
  console.log(`Cluster '${name}' deleted.`)
}

/**
 * List k3d clusters as JSON objects.
 */
export interface K3dCluster {
  name: string;
  nodes?: Array<{ name: string; role: string; state?: { running?: boolean; status?: string } }>;
}

export async function listK3dClusters(): Promise<K3dCluster[]> {
  await ensureK3d()
  const result = await captureOrThrow(["k3d", "cluster", "list", "--output", "json"])
  try {
    return JSON.parse(result.stdout)
  } catch {
    return []
  }
}

/**
 * Extract kubeconfig for a k3d cluster and save to ~/.config/dx/.
 *
 * Always re-fetches from k3d to pick up fresh TLS certs — k3d generates
 * new server certs on each cluster create, and stale certs cause
 * "x509: certificate signed by unknown authority" kubectl errors.
 */
export async function getK3dKubeconfig(name: string): Promise<string> {
  mkdirSync(DX_CONFIG_DIR, { recursive: true })
  const kubeconfigPath = join(DX_CONFIG_DIR, `kubeconfig-${name}.yaml`)

  const result = await captureOrThrow(["k3d", "kubeconfig", "get", name])
  writeFileSync(kubeconfigPath, result.stdout)

  // Verify the kubeconfig works (catches stale TLS certs early)
  const verify = await capture([
    "kubectl", "--kubeconfig", kubeconfigPath,
    "cluster-info", "--request-timeout=5s",
  ])
  if (verify.exitCode !== 0 && verify.stderr.includes("x509")) {
    console.warn(
      `[k3d] TLS cert mismatch detected for cluster '${name}'. ` +
      `This usually means the cluster was recreated. Regenerating kubeconfig...`
    )
    // Force k3d to overwrite the merged kubeconfig entry
    const regen = await capture([
      "k3d", "kubeconfig", "get", name, "--output", "raw",
    ])
    if (regen.exitCode === 0) {
      writeFileSync(kubeconfigPath, regen.stdout)
    }
  }

  return kubeconfigPath
}
