import { PlaneHeader, StatusBadge, EmptyState } from "@/components/factory"
import { useProxmoxClusters } from "@/lib/infra"

export default function ProxmoxPage() {
  const { data: clusters, isLoading } = useProxmoxClusters()

  return (
    <div className="space-y-6 p-6">
      <PlaneHeader plane="infra" title="Proxmox Clusters" description="Proxmox VE cluster sync status" />

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {!isLoading && (clusters ?? []).length === 0 && <EmptyState icon="icon-[ph--cube-duotone]" title="No Proxmox clusters" />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(clusters ?? []).map((c) => (
          <div key={c.id} className="rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between">
              <h3 className="font-medium">{c.name}</h3>
              <StatusBadge status={c.syncStatus} />
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{c.apiHost}:{c.apiPort}</p>
            <div className="mt-3 space-y-1 text-xs text-muted-foreground">
              <p>Last sync: {c.lastSyncAt ? new Date(c.lastSyncAt).toLocaleString() : "Never"}</p>
              {c.syncError && (
                <p className="text-red-400">Error: {c.syncError}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
