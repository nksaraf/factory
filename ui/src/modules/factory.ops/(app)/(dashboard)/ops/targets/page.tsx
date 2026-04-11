import { useDeploymentTargets } from "@/lib/fleet"
import { useState } from "react"
import { Link } from "react-router"

import { Input } from "@rio.js/ui/input"

import { EmptyState, PlaneHeader, StatusBadge } from "@/components/factory"

export default function DeploymentTargetsPage() {
  const { data: targets, isLoading } = useDeploymentTargets()
  const [search, setSearch] = useState("")
  const [kindFilter, setKindFilter] = useState<string>("")

  const filtered = (targets ?? []).filter((t) => {
    if (search && !t.name.toLowerCase().includes(search.toLowerCase()))
      return false
    if (kindFilter && t.kind !== kindFilter) return false
    return true
  })

  return (
    <div className="space-y-6 p-6">
      <PlaneHeader
        plane="fleet"
        title="Deployment Targets"
        description="All environments across all sites"
      />

      <div className="flex gap-3">
        <Input
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">All kinds</option>
          <option value="production">Production</option>
          <option value="staging">Staging</option>
          <option value="sandbox">Sandbox</option>
          <option value="dev">Dev</option>
        </select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {!isLoading && filtered.length === 0 && (
        <EmptyState
          icon="icon-[ph--crosshair-duotone]"
          title="No targets found"
        />
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="pb-2 pr-4">Name</th>
              <th className="pb-2 pr-4">Kind</th>
              <th className="pb-2 pr-4">Realm</th>
              <th className="pb-2 pr-4">Trigger</th>
              <th className="pb-2 pr-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.id} className="border-b last:border-0">
                <td className="py-2 pr-4">
                  <Link
                    to={`/fleet/targets/${t.slug}`}
                    className="font-medium hover:underline"
                  >
                    {t.name}
                  </Link>
                </td>
                <td className="py-2 pr-4">{t.kind}</td>
                <td className="py-2 pr-4">{t.realm}</td>
                <td className="py-2 pr-4">{t.trigger}</td>
                <td className="py-2 pr-4">
                  <StatusBadge status={t.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
