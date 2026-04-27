import { useSiteStatus, useSiteReconcile } from "@/lib/use-workbench"
import { TileShell } from "../tile-shell"

export function SiteOverviewTile() {
  const { data: status, isLoading } = useSiteStatus()
  const reconcile = useSiteReconcile()

  if (isLoading || !status) {
    return (
      <TileShell
        title="Site Overview"
        icon="icon-[ph--globe-hemisphere-west-duotone]"
      >
        <div className="animate-pulse space-y-2">
          <div className="h-4 w-24 rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-4 w-32 rounded bg-zinc-200 dark:bg-zinc-700" />
        </div>
      </TileShell>
    )
  }

  return (
    <TileShell
      title="Site Overview"
      icon="icon-[ph--globe-hemisphere-west-duotone]"
      status={status.phase === "ready" ? "healthy" : "degraded"}
      actions={
        <button
          onClick={() => reconcile.mutate()}
          disabled={reconcile.isPending}
          className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          {reconcile.isPending ? "Reconciling..." : "Reconcile"}
        </button>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Mode</span>
          <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium dark:bg-zinc-800">
            {status.mode}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Phase</span>
          <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium dark:bg-zinc-800">
            {status.phase}
          </span>
        </div>

        {status.components.length > 0 && (
          <div className="space-y-1">
            <span className="text-xs font-medium text-zinc-500">
              Components
            </span>
            <div className="space-y-1">
              {status.components.map((c) => (
                <div
                  key={c.name}
                  className="flex items-center justify-between rounded bg-zinc-50 px-2 py-1 dark:bg-zinc-800/50"
                >
                  <span className="text-sm">{c.name}</span>
                  <span className="text-xs text-zinc-500">
                    {c.status} / {c.health}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </TileShell>
  )
}
