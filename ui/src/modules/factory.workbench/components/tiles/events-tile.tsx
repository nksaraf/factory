import { useSiteEvents } from "@/lib/use-workbench"
import { TileShell } from "../tile-shell"

const eventTypeColors: Record<string, string> = {
  "reconcile-start": "text-blue-500",
  "reconcile-complete": "text-emerald-500",
  "reconcile-error": "text-red-500",
  "step-applied": "text-zinc-600 dark:text-zinc-400",
  "step-failed": "text-red-500",
  "condition-set": "text-amber-500",
}

export function EventsTile() {
  const { events } = useSiteEvents()

  return (
    <TileShell
      title="Events"
      icon="icon-[ph--lightning-duotone]"
      actions={
        <span className="text-xs text-zinc-400">{events.length} events</span>
      }
    >
      <div className="max-h-60 space-y-1 overflow-auto">
        {events.length === 0 ? (
          <span className="text-sm text-zinc-400">
            No events yet — waiting for reconciliation...
          </span>
        ) : (
          [...events].reverse().map((event, i) => (
            <div
              key={`${event.timestamp}-${i}`}
              className="flex items-start gap-2 rounded bg-zinc-50 px-2 py-1 dark:bg-zinc-800/50"
            >
              <span
                className={`mt-0.5 text-xs font-medium ${eventTypeColors[event.type] ?? "text-zinc-500"}`}
              >
                {event.type}
              </span>
              <span className="flex-1 text-xs text-zinc-500">
                {event.reconciliationId.slice(0, 8)}
              </span>
              <span className="text-xs text-zinc-400">
                {new Date(event.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
      </div>
    </TileShell>
  )
}
