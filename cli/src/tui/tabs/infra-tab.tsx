import { Box } from "ink"
import React from "react"

import { DetailPane } from "../components/detail-pane.js"
import { ResourceTree, type TreeNode } from "../components/resource-tree.js"

interface InfraTabProps {
  estates: any[]
  realms: any[]
  workbenches: any[]
  focused: boolean
}

function buildTree(
  estates: any[],
  realms: any[],
  workbenches: any[]
): TreeNode[] {
  return estates.map((p) => {
    const seenRealms = new Set<string>()
    const estateRealms = realms.filter((c: any) => {
      const matches =
        c.estateId === p.estateId ||
        c.estateId === p.id ||
        c.estateSlug === p.slug
      if (!matches) return false
      const cid = c.realmId ?? c.id ?? c.name
      if (seenRealms.has(cid)) return false
      seenRealms.add(cid)
      return true
    })

    return {
      id: p.estateId ?? p.id ?? p.name,
      name: p.name ?? p.slug ?? "unknown",
      slug: p.slug,
      type: "estate" as const,
      status: p.status,
      children: estateRealms.map((c: any) => {
        const cid = c.realmId ?? c.id
        const seen = new Set<string>()
        const realmWorkbenches = workbenches.filter((s: any) => {
          const matches =
            s.realmId === c.realmId ||
            s.realmId === c.id ||
            s.realmSlug === c.slug
          if (!matches) return false
          const sid = s.workbenchId ?? s.id ?? s.name
          if (seen.has(sid)) return false
          seen.add(sid)
          return true
        })

        return {
          id: c.realmId ?? c.id ?? c.name,
          name: c.name ?? c.slug ?? "unknown",
          slug: c.slug,
          type: "realm" as const,
          status: c.status,
          estateId: p.estateId ?? p.id,
          children: realmWorkbenches.map((s: any) => ({
            id: s.workbenchId ?? s.id ?? s.name,
            name: s.name ?? s.slug ?? "unknown",
            slug: s.slug,
            type: "workbench" as const,
            status: s.status,
            realmId: c.realmId ?? c.id,
            estateId: p.estateId ?? p.id,
          })),
        }
      }),
    }
  })
}

export function InfraTab({
  estates,
  realms,
  workbenches,
  focused,
}: InfraTabProps) {
  const tree = buildTree(estates, realms, workbenches)

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
          workbenches={workbenches}
          realms={realms}
          estates={estates}
        />
      </Box>
    </Box>
  )
}
