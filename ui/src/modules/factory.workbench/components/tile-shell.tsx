import type { ReactNode } from "react"

interface TileShellProps {
  title: string
  icon?: string
  status?: "healthy" | "degraded" | "unhealthy" | "unknown"
  children: ReactNode
  actions?: ReactNode
}

const statusColors = {
  healthy: "bg-emerald-500",
  degraded: "bg-amber-500",
  unhealthy: "bg-red-500",
  unknown: "bg-zinc-400",
} as const

export function TileShell({
  title,
  icon,
  status,
  children,
  actions,
}: TileShellProps) {
  return (
    <div className="flex flex-col rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        {icon && <span className={`${icon} h-4 w-4 text-zinc-500`} />}
        <span className="flex-1 text-sm font-medium">{title}</span>
        {status && (
          <span className={`h-2 w-2 rounded-full ${statusColors[status]}`} />
        )}
        {actions}
      </div>
      <div className="flex-1 overflow-auto p-4">{children}</div>
    </div>
  )
}
