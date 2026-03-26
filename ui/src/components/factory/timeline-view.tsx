import { cn } from "@rio.js/ui/lib/utils"

interface TimelineEntry {
  id: string
  label: string
  timestamp: string
  status?: "complete" | "active" | "pending" | "error"
  description?: string
}

interface TimelineViewProps {
  entries: TimelineEntry[]
  className?: string
}

const DOT_STYLES: Record<string, string> = {
  complete: "bg-emerald-500",
  active: "bg-blue-500 animate-pulse",
  pending: "bg-zinc-400",
  error: "bg-red-500",
}

export function TimelineView({ entries, className }: TimelineViewProps) {
  return (
    <div className={cn("relative space-y-0", className)}>
      {entries.map((entry, i) => (
        <div key={entry.id} className="relative flex gap-3 pb-6 last:pb-0">
          {/* Vertical line */}
          {i < entries.length - 1 && (
            <div className="absolute left-[7px] top-4 h-full w-px bg-border" />
          )}
          {/* Dot */}
          <div
            className={cn(
              "relative mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-background",
              DOT_STYLES[entry.status ?? "pending"]
            )}
          />
          {/* Content */}
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium">{entry.label}</span>
              <span className="text-xs text-muted-foreground">
                {entry.timestamp}
              </span>
            </div>
            {entry.description && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {entry.description}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
