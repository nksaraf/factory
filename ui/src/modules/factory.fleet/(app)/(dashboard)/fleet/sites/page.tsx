import { useState } from "react"
import { Link } from "react-router"

import { Input } from "@rio.js/ui/input"

import { PlaneHeader, StatusBadge, EmptyState } from "@/components/factory"
import { useFleetSites } from "@/lib/fleet"

export default function FleetSitesPage() {
  const { data: sites, isLoading } = useFleetSites()
  const [search, setSearch] = useState("")

  const filtered = (sites ?? []).filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.product.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6 p-6">
      <PlaneHeader plane="fleet" title="Fleet Map" description="All deployed sites" />

      <Input
        placeholder="Search sites..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {isLoading && <p className="text-sm text-muted-foreground">Loading sites...</p>}

      {!isLoading && filtered.length === 0 && (
        <EmptyState
          icon="icon-[ph--globe-hemisphere-west-duotone]"
          title="No sites found"
          description="No deployed sites match your search."
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((site) => (
          <Link
            key={site.id}
            to={`/fleet/sites/${site.slug}`}
            className="block rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-medium">{site.name}</h3>
              <StatusBadge status={site.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{site.product}</p>
            <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
              <span>Cluster: {site.clusterId}</span>
              {site.currentManifestVersion && (
                <span>Manifest v{site.currentManifestVersion}</span>
              )}
            </div>
            {site.lastCheckinAt && (
              <p className="mt-1 text-xs text-muted-foreground">
                Last check-in: {new Date(site.lastCheckinAt).toLocaleString()}
              </p>
            )}
          </Link>
        ))}
      </div>
    </div>
  )
}
