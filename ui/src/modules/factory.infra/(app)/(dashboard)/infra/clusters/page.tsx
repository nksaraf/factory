import { useState } from "react"
import { Link } from "react-router"

import { Input } from "@rio.js/ui/input"

import { PlaneHeader, StatusBadge, EmptyState } from "@/components/factory"
import { useClusters, useProviders } from "@/lib/infra"

export default function ClustersPage() {
  const { data: clusters, isLoading } = useClusters()
  const { data: providers } = useProviders()
  const [search, setSearch] = useState("")

  const providerMap = Object.fromEntries((providers ?? []).map((p) => [p.id, p]))
  const filtered = (clusters ?? []).filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-6 p-6">
      <PlaneHeader plane="infra" title="Clusters" description="Kubernetes clusters across all providers" />

      <Input placeholder="Search clusters..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {!isLoading && filtered.length === 0 && <EmptyState icon="icon-[ph--circles-three-plus-duotone]" title="No clusters" />}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-muted-foreground">
            <th className="pb-2 pr-4">Name</th>
            <th className="pb-2 pr-4">Provider</th>
            <th className="pb-2 pr-4">Status</th>
          </tr></thead>
          <tbody>{filtered.map((c) => (
            <tr key={c.id} className="border-b last:border-0">
              <td className="py-2 pr-4">
                <Link to={`/infra/clusters/${c.slug}`} className="font-medium hover:underline">{c.name}</Link>
              </td>
              <td className="py-2 pr-4">{providerMap[c.providerId]?.name ?? c.providerId}</td>
              <td className="py-2 pr-4"><StatusBadge status={c.status} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}
