import { useParams } from "react-router"

import {
  PlaneHeader,
  StatusBadge,
  MetricCard,
  EmptyState,
} from "@/components/factory"
import { useClusters, useKubeNodes } from "@/lib/infra"

export default function ClusterDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: clusters, isLoading } = useClusters()
  const cluster = (clusters ?? []).find((c) => c.slug === slug)
  const { data: nodes } = useKubeNodes(
    cluster ? { clusterId: cluster.id } : undefined
  )

  if (isLoading)
    return <p className="p-6 text-sm text-muted-foreground">Loading...</p>
  if (!cluster) return <EmptyState title="Cluster not found" />

  const servers = (nodes ?? []).filter((n) => n.role === "server")
  const agents = (nodes ?? []).filter((n) => n.role === "agent")
  const ready = (nodes ?? []).filter((n) => n.status === "ready")

  return (
    <div className="space-y-6 p-6">
      <PlaneHeader
        plane="infra"
        title={cluster.name}
        description={cluster.slug}
        actions={<StatusBadge status={cluster.status} />}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <MetricCard
          label="Total Nodes"
          value={(nodes ?? []).length}
          plane="infra"
        />
        <MetricCard label="Servers" value={servers.length} plane="infra" />
        <MetricCard label="Agents" value={agents.length} plane="infra" />
        <MetricCard label="Ready" value={ready.length} plane="infra" />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Nodes</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="pb-2 pr-4">Name</th>
              <th className="pb-2 pr-4">Role</th>
              <th className="pb-2 pr-4">IP</th>
              <th className="pb-2 pr-4">VM</th>
              <th className="pb-2 pr-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {(nodes ?? []).map((n) => (
              <tr key={n.id} className="border-b last:border-0">
                <td className="py-2 pr-4 font-medium">{n.name}</td>
                <td className="py-2 pr-4">{n.role}</td>
                <td className="py-2 pr-4 font-mono text-xs">{n.ipAddress}</td>
                <td className="py-2 pr-4 text-xs">{n.vmId ?? "—"}</td>
                <td className="py-2 pr-4">
                  <StatusBadge status={n.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
