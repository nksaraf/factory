import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@rio.js/ui/lib/utils"

const statusVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      status: {
        running: "bg-emerald-500/10 text-emerald-500",
        active: "bg-emerald-500/10 text-emerald-500",
        ready: "bg-emerald-500/10 text-emerald-500",
        succeeded: "bg-emerald-500/10 text-emerald-500",
        production: "bg-emerald-500/10 text-emerald-500",
        provisioning: "bg-blue-500/10 text-blue-500",
        pending: "bg-blue-500/10 text-blue-500",
        draft: "bg-blue-500/10 text-blue-500",
        staging: "bg-blue-500/10 text-blue-500",
        in_progress: "bg-blue-500/10 text-blue-500",
        degraded: "bg-amber-500/10 text-amber-500",
        warning: "bg-amber-500/10 text-amber-500",
        maintenance: "bg-amber-500/10 text-amber-500",
        suspended: "bg-amber-500/10 text-amber-500",
        failed: "bg-red-500/10 text-red-500",
        error: "bg-red-500/10 text-red-500",
        critical: "bg-red-500/10 text-red-500",
        offline: "bg-red-500/10 text-red-500",
        destroyed: "bg-red-500/10 text-red-500",
        decommissioned: "bg-red-500/10 text-red-500",
        stopped: "bg-zinc-500/10 text-zinc-500",
        unknown: "bg-zinc-500/10 text-zinc-500",
        idle: "bg-zinc-500/10 text-zinc-500",
        paused: "bg-zinc-500/10 text-zinc-500",
        rolled_back: "bg-amber-500/10 text-amber-500",
        superseded: "bg-zinc-500/10 text-zinc-500",
      },
    },
    defaultVariants: { status: "unknown" },
  }
)

type StatusValue = NonNullable<VariantProps<typeof statusVariants>["status"]>

const DOT_COLORS: Record<string, string> = {
  running: "bg-emerald-500",
  active: "bg-emerald-500",
  ready: "bg-emerald-500",
  succeeded: "bg-emerald-500",
  production: "bg-emerald-500",
  provisioning: "bg-blue-500 animate-pulse",
  pending: "bg-blue-500 animate-pulse",
  draft: "bg-blue-500",
  staging: "bg-blue-500",
  in_progress: "bg-blue-500 animate-pulse",
  degraded: "bg-amber-500 animate-pulse",
  warning: "bg-amber-500",
  maintenance: "bg-amber-500",
  suspended: "bg-amber-500",
  failed: "bg-red-500",
  error: "bg-red-500",
  critical: "bg-red-500 animate-pulse",
  offline: "bg-red-500",
  destroyed: "bg-red-500",
  decommissioned: "bg-red-500",
  stopped: "bg-zinc-500",
  unknown: "bg-zinc-500",
  idle: "bg-zinc-500",
  paused: "bg-zinc-500",
  rolled_back: "bg-amber-500",
  superseded: "bg-zinc-500",
}

interface StatusBadgeProps {
  status: string
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const normalized = status.toLowerCase().replace(/-/g, "_") as StatusValue
  const dotColor = DOT_COLORS[normalized] ?? "bg-zinc-500"

  return (
    <span className={cn(statusVariants({ status: normalized }), className)}>
      <span className={cn("inline-block h-1.5 w-1.5 rounded-full", dotColor)} />
      {status.replace(/_/g, " ")}
    </span>
  )
}
