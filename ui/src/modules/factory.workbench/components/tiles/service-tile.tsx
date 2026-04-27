import { useSiteHealth, useServiceRestart } from "@/lib/use-workbench"
import { TileShell } from "../tile-shell"

export function ServiceTile() {
  const { data: health, isLoading } = useSiteHealth()
  const restart = useServiceRestart()

  if (isLoading || !health) {
    return (
      <TileShell title="Service Health" icon="icon-[ph--heartbeat-duotone]">
        <div className="animate-pulse space-y-2">
          <div className="h-4 w-24 rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-4 w-32 rounded bg-zinc-200 dark:bg-zinc-700" />
        </div>
      </TileShell>
    )
  }

  const overallStatus =
    health.overallStatus === "healthy"
      ? "healthy"
      : health.overallStatus === "degraded"
        ? "degraded"
        : "unhealthy"

  return (
    <TileShell
      title="Service Health"
      icon="icon-[ph--heartbeat-duotone]"
      status={overallStatus}
    >
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Overall</span>
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              overallStatus === "healthy"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                : overallStatus === "degraded"
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
            }`}
          >
            {health.overallStatus}
          </span>
        </div>

        {Object.entries(health.components).length > 0 && (
          <div className="space-y-1">
            {Object.entries(health.components).map(([name, status]) => (
              <div
                key={name}
                className="flex items-center justify-between rounded bg-zinc-50 px-2 py-1 dark:bg-zinc-800/50"
              >
                <span className="text-sm">{name}</span>
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      status === "healthy"
                        ? "bg-emerald-500"
                        : status === "starting"
                          ? "bg-amber-500"
                          : status === "none"
                            ? "bg-zinc-400"
                            : "bg-red-500"
                    }`}
                  />
                  <button
                    onClick={() => restart.mutate(name)}
                    disabled={restart.isPending}
                    className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                    title="Restart"
                  >
                    <span className="icon-[ph--arrow-clockwise] h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="text-xs text-zinc-400">
          Last check:{" "}
          {health.checkedAt
            ? new Date(health.checkedAt).toLocaleTimeString()
            : "—"}
        </div>
      </div>
    </TileShell>
  )
}
