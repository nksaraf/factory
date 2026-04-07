/**
 * Ensure a healthy k3d cluster is available before starting the local daemon.
 *
 * Steps:
 *   1. Verify k3d is installed (auto-install if missing)
 *   2. Check if dx-local cluster exists
 *   3. If exists, verify API server reachable; recover if not
 *   4. If missing, create it with correct NodePort mappings
 *   5. Validate NodePort range is mapped (recreate if not)
 *   6. Return kubeconfig path
 */

import { log } from "../lib/logger.js";
import { DxError } from "../lib/dx-error.js";
import { capture } from "../lib/subprocess.js";
import {
  ensureK3d,
  createK3dCluster,
  deleteK3dCluster,
  getK3dKubeconfig,
  listK3dClusters,
  type K3dCreateOptions,
} from "../handlers/cluster/k3d.js";

const DEFAULT_CLUSTER_NAME = "dx-local";

/** Default host-side NodePort range for workspace services. */
const DEFAULT_PORT_LO = 30000;
const DEFAULT_PORT_HI = 30200;

/**
 * Check whether the k8s API server is reachable via the given kubeconfig.
 */
async function isApiReachable(kubeconfigPath: string): Promise<boolean> {
  const result = await capture([
    "kubectl",
    "--kubeconfig", kubeconfigPath,
    "cluster-info",
    "--request-timeout=5s",
  ]);
  return result.exitCode === 0;
}

/**
 * Parse k3d cluster list JSON to check if NodePort range 30000-30200 is mapped.
 * k3d stores port mappings in each node's portMappings field.
 */
function hasNodePortRange(clusters: any[], clusterName: string, portLo: number, portHi: number): boolean {
  const cluster = clusters.find((c: any) => c.name === clusterName);
  if (!cluster) return false;

  // Check all nodes (server + loadbalancer) for port mappings that cover our range
  const nodes = cluster.nodes ?? [];
  for (const node of nodes) {
    const portMappings = node.portMappings ?? {};
    // k3d stores as { "30000/tcp": [{ HostPort: "30000" }], ... } or similar
    // Check if at least the first port in the range is mapped
    const portKeys = Object.keys(portMappings);
    for (const key of portKeys) {
      const port = parseInt(key, 10);
      if (port >= portLo && port <= portHi) return true;
    }
    // Also check the loadbalancer-style: nat port entries
    if (portMappings[`${portLo}/tcp`] || portMappings["nat"]) return true;
  }

  return false;
}

/**
 * Ensure a healthy k3d cluster is ready.
 * Returns the kubeconfig path.
 *
 * @param clusterName - Cluster name (default: "dx-local")
 */
export async function ensureLocalCluster(
  clusterName = DEFAULT_CLUSTER_NAME,
  opts?: Omit<K3dCreateOptions, "name">,
): Promise<string> {
  // Step 1: Ensure k3d binary
  log.debug("Checking k3d installation...");
  try {
    await ensureK3d();
    log.debug("k3d is installed.");
  } catch (err) {
    throw DxError.wrap(err, {
      operation: "ensure k3d installed",
      code: "K3D_NOT_INSTALLED",
      suggestions: [
        { action: "brew install k3d", description: "Install k3d on macOS" },
        { action: "curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash", description: "Install k3d on Linux" },
      ],
    });
  }

  // Step 2: Check if cluster exists
  log.debug(`Checking for existing ${clusterName} cluster...`);
  const clusters = await listK3dClusters();
  const exists = clusters.some((c: any) => c.name === clusterName);

  if (exists) {
    log.debug(`Cluster ${clusterName} exists. Verifying API server...`);

    // Step 3: Verify API server reachable
    let kubeconfigPath: string;
    try {
      kubeconfigPath = await getK3dKubeconfig(clusterName);
    } catch (err) {
      throw DxError.wrap(err, {
        operation: "get k3d kubeconfig",
        metadata: { cluster: clusterName },
        code: "K3D_KUBECONFIG_FAILED",
      });
    }

    if (await isApiReachable(kubeconfigPath)) {
      // Step 5: Validate NodePort range
      const portLo = opts?.nodePortLo ?? DEFAULT_PORT_LO;
      const portHi = opts?.nodePortHi ?? DEFAULT_PORT_HI;
      if (hasNodePortRange(clusters, clusterName, portLo, portHi)) {
        log.debug("Cluster healthy with correct NodePort range.");
        return kubeconfigPath;
      }

      // NodePort range missing — must recreate
      log.info("Cluster exists but NodePort range 30000-30200 not mapped. Recreating...");
      await deleteK3dCluster(clusterName);
      const result = await createK3dCluster({ name: clusterName, ...opts });
      return result.kubeconfigPath;
    }

    // API not reachable — try start
    log.info("Cluster exists but API server unreachable. Attempting restart...");
    const startResult = await capture(["k3d", "cluster", "start", clusterName]);
    if (startResult.exitCode !== 0) {
      log.warn("Restart failed. Deleting and recreating cluster...");
      await deleteK3dCluster(clusterName);
      const result = await createK3dCluster({ name: clusterName, ...opts });
      return result.kubeconfigPath;
    }

    // Re-fetch kubeconfig after restart (certs may have changed)
    kubeconfigPath = await getK3dKubeconfig(clusterName);

    // Verify again after restart
    if (await isApiReachable(kubeconfigPath)) {
      log.debug("Cluster recovered after restart.");
      return kubeconfigPath;
    }

    // Still unreachable — nuclear option
    log.warn("API still unreachable after restart. Recreating cluster from scratch...");
    await deleteK3dCluster(clusterName);
    const result = await createK3dCluster({ name: clusterName, ...opts });
    return result.kubeconfigPath;
  }

  // Step 4: Cluster doesn't exist — create it
  log.info(`Creating k3d cluster '${clusterName}'...`);
  try {
    const result = await createK3dCluster({ name: clusterName, ...opts });
    log.info("Cluster ready.");
    return result.kubeconfigPath;
  } catch (err) {
    throw DxError.wrap(err, {
      operation: "create k3d cluster",
      metadata: { cluster: clusterName },
      code: "K3D_CREATE_FAILED",
      suggestions: [
        { action: "docker info", description: "Check if Docker is running" },
        { action: "k3d cluster list", description: "Check existing clusters" },
      ],
    });
  }
}
