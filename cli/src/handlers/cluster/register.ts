/**
 * Register a local cluster in the factory database via the API.
 */
import { existsSync, readFileSync } from "node:fs"

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

  // Look up the "local" estate (optional — compose factory may not have one)
  let estateId: string | undefined
  try {
    const estatesRes = await rest.listEntities("infra", "estates")
    const estates = estatesRes?.data ?? []
    const localEstate = estates.find((s) => s.slug === "local")
    estateId = localEstate?.id as string | undefined
  } catch {
    // Estate lookup failed — proceed without it
  }

  // Check if realm already exists
  const realmsRes = await rest.listEntities("infra", "realms")
  const realms = realmsRes?.data ?? []
  const existing = realms.find(
    (r) => r.slug === clusterName || r.name === clusterName
  )

  if (existing) {
    // Update kubeconfig and isDefault (e.g. after k3d recreates with new TLS certs)
    try {
      await rest.updateEntity("infra", "realms", existing.id as string, {
        spec: {
          ...(existing.spec as Record<string, unknown>),
          kubeconfigRef: kubeconfigContent,
          isDefault: true,
        },
      })
      console.log(`Realm '${clusterName}' updated in local factory.`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`Failed to update realm: ${msg}`)
    }
    return
  }

  // Create realm via API
  try {
    const spec: Record<string, unknown> = {
      kubeconfigRef: kubeconfigContent,
      isDefault: true,
    }
    if (estateId) spec.estateId = estateId

    await rest.createEntity("infra", "realms", {
      name: clusterName,
      slug: clusterName,
      type: "k8s-cluster",
      spec,
    })
    console.log(`Realm '${clusterName}' registered in local factory.`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`Failed to register realm: ${msg}`)
  }
}
