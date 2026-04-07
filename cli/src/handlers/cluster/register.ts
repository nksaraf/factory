/**
 * Register a local cluster in the factory database via the API.
 */

import { readFileSync, existsSync } from "node:fs"
import { getFactoryRestClient } from "../../client.js"

/**
 * Register (or update) a local cluster by calling the local factory API.
 * The auto-start hook in client.ts ensures the daemon is running.
 */
export async function seedLocalInfra(
  clusterName: string,
  kubeconfigPath: string
): Promise<void> {
  // Read kubeconfig content — always store inline YAML, never file paths.
  const kubeconfigContent = existsSync(kubeconfigPath)
    ? readFileSync(kubeconfigPath, "utf-8")
    : kubeconfigPath // already inline content

  const rest = await getFactoryRestClient()

  // Look up the "local" substrate (optional — compose factory may not have one)
  let substrateId: string | undefined
  try {
    const substratesRes = await rest.listEntities("infra", "substrates")
    const substrates = substratesRes?.data ?? []
    const localSubstrate = substrates.find((s) => s.slug === "local")
    substrateId = localSubstrate?.id as string | undefined
  } catch {
    // Substrate lookup failed — proceed without it
  }

  // Check if runtime already exists
  const runtimesRes = await rest.listEntities("infra", "runtimes")
  const runtimes = runtimesRes?.data ?? []
  const existing = runtimes.find((r) => r.slug === clusterName || r.name === clusterName)

  if (existing) {
    // Update kubeconfig and isDefault (e.g. after k3d recreates with new TLS certs)
    try {
      await rest.updateEntity("infra", "runtimes", existing.id as string, {
        spec: {
          ...(existing.spec as Record<string, unknown>),
          kubeconfigRef: kubeconfigContent,
          isDefault: true,
        },
      })
      console.log(`Runtime '${clusterName}' updated in local factory.`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`Failed to update runtime: ${msg}`)
    }
    return
  }

  // Create runtime via API
  try {
    const spec: Record<string, unknown> = {
      kubeconfigRef: kubeconfigContent,
      isDefault: true,
    }
    if (substrateId) spec.substrateId = substrateId

    await rest.createEntity("infra", "runtimes", {
      name: clusterName,
      slug: clusterName,
      type: "k8s-cluster",
      spec,
    })
    console.log(`Runtime '${clusterName}' registered in local factory.`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`Failed to register runtime: ${msg}`)
  }
}
