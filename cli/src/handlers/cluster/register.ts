/**
 * Register a local cluster in the factory database via the API.
 */

import { getFactoryClient } from "../../client.js"

/**
 * Register (or update) a local cluster by calling the local factory API.
 * The auto-start hook in client.ts ensures the daemon is running.
 */
export async function seedLocalInfra(
  clusterName: string,
  kubeconfigPath: string
): Promise<void> {
  const api = await getFactoryClient()

  // Look up the "local" provider to get its ID
  const providersRes = await (api as any).api.v1.factory.infra.providers.get({
    query: {},
  })
  const providers = providersRes?.data?.data ?? providersRes?.data ?? []
  const localProvider = Array.isArray(providers)
    ? providers.find((p: any) => p.slug === "local")
    : null

  if (!localProvider) {
    console.warn("Local provider not found in factory — daemon may not have seeded yet.")
    return
  }

  // Check if cluster already exists
  const clustersRes = await (api as any).api.v1.factory.infra.clusters.get({
    query: {},
  })
  const clusters = clustersRes?.data?.data ?? clustersRes?.data ?? []
  const existing = Array.isArray(clusters)
    ? clusters.find((c: any) => c.slug === clusterName || c.name === clusterName)
    : null

  if (existing) {
    console.log(`Cluster '${clusterName}' already registered in local factory.`)
    return
  }

  // Create cluster via API
  const res = await (api as any).api.v1.factory.infra.clusters.post({
    name: clusterName,
    slug: clusterName,
    providerId: localProvider.providerId,
    kubeconfigRef: kubeconfigPath,
  })

  if (res?.data?.success) {
    console.log(`Cluster '${clusterName}' registered in local factory.`)
  } else {
    console.warn(`Failed to register cluster: ${JSON.stringify(res?.error ?? res?.data)}`)
  }
}
