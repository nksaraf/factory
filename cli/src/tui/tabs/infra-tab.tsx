import React from "react"
import { Box } from "ink"
import { ResourceTree, type TreeNode } from "../components/resource-tree.js"
import { DetailPane } from "../components/detail-pane.js"

interface InfraTabProps {
  providers: any[]
  clusters: any[]
  sandboxes: any[]
  focused: boolean
}

function buildTree(
  providers: any[],
  clusters: any[],
  sandboxes: any[]
): TreeNode[] {
  return providers.map((p) => {
    const seenClusters = new Set<string>()
    const providerClusters = clusters.filter((c: any) => {
      const matches =
        c.providerId === p.providerId ||
        c.providerId === p.id ||
        c.providerSlug === p.slug
      if (!matches) return false
      const cid = c.clusterId ?? c.id ?? c.name
      if (seenClusters.has(cid)) return false
      seenClusters.add(cid)
      return true
    })

    return {
      id: p.providerId ?? p.id ?? p.name,
      name: p.name ?? p.slug ?? "unknown",
      slug: p.slug,
      type: "provider" as const,
      status: p.status,
      children: providerClusters.map((c: any) => {
        const cid = c.clusterId ?? c.id
        const seen = new Set<string>()
        const clusterSandboxes = sandboxes.filter((s: any) => {
          const matches =
            s.clusterId === c.clusterId ||
            s.clusterId === c.id ||
            s.clusterSlug === c.slug
          if (!matches) return false
          const sid = s.sandboxId ?? s.id ?? s.name
          if (seen.has(sid)) return false
          seen.add(sid)
          return true
        })

        return {
          id: c.clusterId ?? c.id ?? c.name,
          name: c.name ?? c.slug ?? "unknown",
          slug: c.slug,
          type: "cluster" as const,
          status: c.status,
          providerId: p.providerId ?? p.id,
          children: clusterSandboxes.map((s: any) => ({
            id: s.sandboxId ?? s.id ?? s.name,
            name: s.name ?? s.slug ?? "unknown",
            slug: s.slug,
            type: "sandbox" as const,
            status: s.status,
            clusterId: c.clusterId ?? c.id,
            providerId: p.providerId ?? p.id,
          })),
        }
      }),
    }
  })
}

export function InfraTab({
  providers,
  clusters,
  sandboxes,
  focused,
}: InfraTabProps) {
  const tree = buildTree(providers, clusters, sandboxes)

  return (
    <Box flexGrow={1} flexDirection="row">
      <Box
        width="40%"
        flexDirection="column"
        borderStyle="single"
        borderRight
        borderTop={false}
        borderBottom={false}
        borderLeft={false}
      >
        <ResourceTree nodes={tree} focused={focused} />
      </Box>
      <Box width="60%" flexDirection="column" paddingLeft={1}>
        <DetailPane
          sandboxes={sandboxes}
          clusters={clusters}
          providers={providers}
        />
      </Box>
    </Box>
  )
}
