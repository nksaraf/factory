import { useState } from "react"
import { Link } from "react-router"

import { Input } from "@rio.js/ui/input"

import { PlaneHeader, StatusBadge, EmptyState } from "@/components/factory"
import { useProviders } from "@/lib/infra"

import { ProviderTypeIcon } from "../../../components/provider-type-icon"

export default function ProvidersPage() {
  const { data: providers, isLoading } = useProviders()
  const [search, setSearch] = useState("")

  const filtered = (providers ?? []).filter(
    (p) => p.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6 p-6">
      <PlaneHeader plane="infra" title="Providers" description="Infrastructure providers — cloud and on-premise" />

      <Input placeholder="Search providers..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {!isLoading && filtered.length === 0 && <EmptyState icon="icon-[ph--cloud-duotone]" title="No providers" />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((p) => (
          <Link
            key={p.id}
            to={`/infra/providers/${p.slug}`}
            className="block rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <ProviderTypeIcon type={p.providerType} />
                <h3 className="font-medium">{p.name}</h3>
              </div>
              <StatusBadge status={p.status} />
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              <span>{p.providerType}</span>
              <span className="ml-3">{p.providerKind}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
