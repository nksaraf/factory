import { useReleases } from "@/lib/ops"
import { useState } from "react"

import { EmptyState, PlaneHeader, StatusBadge } from "@/components/factory"

export default function ReleasesPage() {
  const { data: releases, isLoading } = useReleases()
  const [statusFilter, setStatusFilter] = useState("")

  const filtered = (releases ?? []).filter(
    (r) => !statusFilter || r.status === statusFilter
  )

  return (
    <div className="space-y-6 p-6">
      <PlaneHeader
        plane="ops"
        title="Release Manager"
        description="All releases and their lifecycle"
      />

      <select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
        className="rounded-md border bg-background px-3 py-2 text-sm"
      >
        <option value="">All statuses</option>
        <option value="draft">Draft</option>
        <option value="staging">Staging</option>
        <option value="production">Production</option>
        <option value="superseded">Superseded</option>
        <option value="failed">Failed</option>
      </select>

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {!isLoading && filtered.length === 0 && (
        <EmptyState
          icon="icon-[ph--package-duotone]"
          title="No releases found"
        />
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="pb-2 pr-4">Version</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2 pr-4">Created By</th>
              <th className="pb-2 pr-4">Created At</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="py-2 pr-4 font-medium font-mono">{r.version}</td>
                <td className="py-2 pr-4">
                  <StatusBadge status={r.status} />
                </td>
                <td className="py-2 pr-4">{r.createdBy}</td>
                <td className="py-2 pr-4 text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
