import { ArrowDown, ArrowUp, Minus } from "lucide-react"

import type { Block } from "../../../types"

interface KpiData {
  title: string
  value: string | number
  unit?: string
  change?: number
  changeLabel?: string
  icon?: string
}

export function DashboardKpiCard({ block }: { block: Block }) {
  const data = block.data as unknown as KpiData
  const change = data.change ?? 0
  const trend = change > 0 ? "up" : change < 0 ? "down" : "neutral"

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">
          {data.title}
        </p>
        {data.icon && <span className="text-lg">{data.icon}</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl font-bold tracking-tight">
          {typeof data.value === "number"
            ? formatNumber(data.value)
            : data.value}
        </span>
        {data.unit && (
          <span className="text-sm text-muted-foreground">{data.unit}</span>
        )}
      </div>
      {data.change !== undefined && (
        <div className="mt-2 flex items-center gap-1 text-xs">
          {trend === "up" && <ArrowUp className="h-3 w-3 text-emerald-500" />}
          {trend === "down" && <ArrowDown className="h-3 w-3 text-red-500" />}
          {trend === "neutral" && (
            <Minus className="h-3 w-3 text-muted-foreground" />
          )}
          <span
            className={
              trend === "up"
                ? "text-emerald-600"
                : trend === "down"
                  ? "text-red-600"
                  : "text-muted-foreground"
            }
          >
            {change > 0 ? "+" : ""}
            {change}%
          </span>
          {data.changeLabel && (
            <span className="text-muted-foreground">{data.changeLabel}</span>
          )}
        </div>
      )}
    </div>
  )
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}
