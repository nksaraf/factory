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
}

/**
 * Ensure k3d is installed; throw with install instructions if not.
 */
export async function ensureK3d(): Promise<void> {
  const result = await capture(["k3d", "version"])
  if (result.exitCode === 0) return

  // Try to install
  const platform = process.platform
  let installCmd: string | undefined
  if (platform === "darwin") {
    installCmd = "brew install k3d"
  } else if (platform === "linux") {
    installCmd = "curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash"
  }

  if (installCmd) {
    console.log(`k3d not found. Attempting install: ${installCmd}`)
    const installResult = await capture(["sh", "-c", installCmd])
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

  await captureOrThrow([
    "k3d", "cluster", "create", name,
    "--api-port", String(apiPort),
    "-p", `${httpPort}:80@loadbalancer`,
    "-p", `${httpsPort}:443@loadbalancer`,
    "--wait",
  ])

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
export async function listK3dClusters(): Promise<any[]> {
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
 */
export async function getK3dKubeconfig(name: string): Promise<string> {
  mkdirSync(DX_CONFIG_DIR, { recursive: true })
  const kubeconfigPath = join(DX_CONFIG_DIR, `kubeconfig-${name}.yaml`)

  const result = await captureOrThrow(["k3d", "kubeconfig", "get", name])
  writeFileSync(kubeconfigPath, result.stdout)

  return kubeconfigPath
}
