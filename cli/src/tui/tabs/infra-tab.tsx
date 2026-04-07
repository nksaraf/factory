import React from "react"
import { Box } from "ink"
import { ResourceTree, type TreeNode } from "../components/resource-tree.js"
import { DetailPane } from "../components/detail-pane.js"

interface InfraTabProps {
  substrates: any[]
  runtimes: any[]
  workspaces: any[]
  focused: boolean
}

function buildTree(
  substrates: any[],
  runtimes: any[],
  workspaces: any[]
): TreeNode[] {
  return substrates.map((p) => {
    const seenRuntimes = new Set<string>()
    const substrateRuntimes = runtimes.filter((c: any) => {
      const matches =
        c.substrateId === p.substrateId ||
        c.substrateId === p.id ||
        c.substrateSlug === p.slug
      if (!matches) return false
      const cid = c.runtimeId ?? c.id ?? c.name
      if (seenRuntimes.has(cid)) return false
      seenRuntimes.add(cid)
      return true
    })

    return {
      id: p.substrateId ?? p.id ?? p.name,
      name: p.name ?? p.slug ?? "unknown",
      slug: p.slug,
      type: "substrate" as const,
      status: p.status,
      children: substrateRuntimes.map((c: any) => {
        const cid = c.runtimeId ?? c.id
        const seen = new Set<string>()
        const runtimeWorkspaces = workspaces.filter((s: any) => {
          const matches =
            s.runtimeId === c.runtimeId ||
            s.runtimeId === c.id ||
            s.runtimeSlug === c.slug
          if (!matches) return false
          const sid = s.workspaceId ?? s.id ?? s.name
          if (seen.has(sid)) return false
          seen.add(sid)
          return true
        })

        return {
          id: c.runtimeId ?? c.id ?? c.name,
          name: c.name ?? c.slug ?? "unknown",
          slug: c.slug,
          type: "runtime" as const,
          status: c.status,
          substrateId: p.substrateId ?? p.id,
          children: runtimeWorkspaces.map((s: any) => ({
            id: s.workspaceId ?? s.id ?? s.name,
            name: s.name ?? s.slug ?? "unknown",
            slug: s.slug,
            type: "workspace" as const,
            status: s.status,
            runtimeId: c.runtimeId ?? c.id,
            substrateId: p.substrateId ?? p.id,
          })),
        }
      }),
    }
  })
}

export function InfraTab({
  substrates,
  runtimes,
  workspaces,
  focused,
}: InfraTabProps) {
  const tree = buildTree(substrates, runtimes, workspaces)

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
          workspaces={workspaces}
          runtimes={runtimes}
          substrates={substrates}
        />
      </Box>
    </Box>
  )
}
