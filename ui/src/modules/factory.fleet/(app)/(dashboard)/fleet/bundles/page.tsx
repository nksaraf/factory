import { useState } from "react"

import { PlaneHeader, StatusBadge, EmptyState } from "@/components/factory"
import { useReleaseBundles, useReleases } from "@/lib/fleet"

export default function BundlesPage() {
  const { data: bundles, isLoading } = useReleaseBundles()
  const { data: releases } = useReleases()
  const [statusFilter, setStatusFilter] = useState("")

  const releaseMap = Object.fromEntries((releases ?? []).map((r) => [r.id, r]))
  const filtered = (bundles ?? []).filter((b) => !statusFilter || b.status === statusFilter)

  return (
    <div className="space-y-6 p-6">
      <PlaneHeader plane="fleet" title="Release Bundles" description="Offline bundles for air-gapped site deployments" />

      <select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
        className="rounded-md border bg-background px-3 py-2 text-sm"
      >
        <option value="">All statuses</option>
        <option value="building">Building</option>
        <option value="ready">Ready</option>
        <option value="failed">Failed</option>
        <option value="expired">Expired</option>
      </select>

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {!isLoading && filtered.length === 0 && (
        <EmptyState icon="icon-[ph--archive-duotone]" title="No release bundles" />
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="pb-2 pr-4">Release</th>
              <th className="pb-2 pr-4">Role</th>
              <th className="pb-2 pr-4">Arch</th>
              <th className="pb-2 pr-4">Images</th>
              <th className="pb-2 pr-4">Size</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2 pr-4">Created</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((b) => (
              <tr key={b.id} className="border-b last:border-0">
                <td className="py-2 pr-4 font-mono">{releaseMap[b.releaseId]?.version ?? b.releaseId}</td>
                <td className="py-2 pr-4">{b.role}</td>
                <td className="py-2 pr-4">{b.arch}</td>
                <td className="py-2 pr-4">{b.imageCount}</td>
                <td className="py-2 pr-4">{b.sizeBytes ? `${Math.round(Number(b.sizeBytes) / 1024 / 1024)} MB` : "—"}</td>
                <td className="py-2 pr-4"><StatusBadge status={b.status} /></td>
                <td className="py-2 pr-4 text-muted-foreground">{new Date(b.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
