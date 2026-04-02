import { useParams } from "react-router"

import { PlaneHeader, StatusBadge, MetricCard, EmptyState } from "@/components/factory"
import { useProviders, useClusters, useHosts, useVMs } from "@/lib/infra"

export default function ProviderDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: providers, isLoading } = useProviders()
  const provider = (providers ?? []).find((p) => p.slug === slug)

  const { data: clusters } = useClusters(provider ? { providerId: provider.id } : undefined)
  const { data: hosts } = useHosts(provider ? { providerId: provider.id } : undefined)
  const { data: vms } = useVMs(provider ? { providerId: provider.id } : undefined)

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Loading...</p>
  if (!provider) return <EmptyState title="Provider not found" />

  return (
    <div className="space-y-6 p-6">
      <PlaneHeader
        plane="infra"
        title={provider.name}
        description={`${provider.providerType} · ${provider.providerKind}`}
        actions={<StatusBadge status={provider.status} />}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Clusters" value={(clusters ?? []).length} plane="infra" />
        <MetricCard label="Hosts" value={(hosts ?? []).length} plane="infra" />
        <MetricCard label="VMs" value={(vms ?? []).length} plane="infra" />
      </div>

      {(clusters ?? []).length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Clusters</h2>
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground">
              <th className="pb-2 pr-4">Name</th><th className="pb-2 pr-4">Status</th>
            </tr></thead>
            <tbody>{(clusters ?? []).map((c) => (
              <tr key={c.id} className="border-b last:border-0">
                <td className="py-2 pr-4 font-medium">{c.name}</td>
                <td className="py-2 pr-4"><StatusBadge status={c.status} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {(hosts ?? []).length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Hosts</h2>
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground">
              <th className="pb-2 pr-4">Name</th><th className="pb-2 pr-4">IP</th><th className="pb-2 pr-4">CPU/Mem/Disk</th><th className="pb-2 pr-4">Status</th>
            </tr></thead>
            <tbody>{(hosts ?? []).map((h) => (
              <tr key={h.id} className="border-b last:border-0">
                <td className="py-2 pr-4 font-medium">{h.name}</td>
                <td className="py-2 pr-4 font-mono text-xs">{h.ipAddress ?? "—"}</td>
                <td className="py-2 pr-4 text-xs">{h.cpuCores}c / {Math.round(h.memoryMb / 1024)}G / {h.diskGb}G</td>
                <td className="py-2 pr-4"><StatusBadge status={h.status} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
