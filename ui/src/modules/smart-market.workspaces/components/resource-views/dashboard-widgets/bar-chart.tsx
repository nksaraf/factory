import { useMemo } from "react"

import type { Block } from "../../../types"

interface BarChartData {
  title: string
  labels: string[]
  series: { name: string; values: number[]; color?: string }[]
  yAxisLabel?: string
}

const DEFAULT_COLORS = [
  "#3b82f6",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
]

export function DashboardBarChart({ block }: { block: Block }) {
  const data = block.data as unknown as BarChartData

  const maxValue = useMemo(() => {
    let max = 0
    for (const s of data.series) {
      for (const v of s.values) {
        if (v > max) max = v
      }
    }
    return max || 1
  }, [data.series])

  const barCount = data.labels.length
  const seriesCount = data.series.length

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <h3 className="text-sm font-medium text-muted-foreground">
        {data.title}
      </h3>

      {/* Legend */}
      {seriesCount > 1 && (
        <div className="mt-2 flex flex-wrap gap-3">
          {data.series.map((s, i) => (
            <div key={s.name} className="flex items-center gap-1.5 text-xs">
              <div
                className="h-2.5 w-2.5 rounded-sm"
                style={{
                  background:
                    s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
                }}
              />
              <span className="text-muted-foreground">{s.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      <div className="mt-4 flex items-end gap-1" style={{ height: 160 }}>
        {data.labels.map((label, li) => (
          <div key={label} className="flex flex-1 flex-col items-center gap-1">
            <div
              className="flex w-full items-end justify-center gap-0.5"
              style={{ height: 140 }}
            >
              {data.series.map((s, si) => {
                const val = s.values[li] ?? 0
                const pct = (val / maxValue) * 100
                return (
                  <div
                    key={s.name}
                    className="flex-1 max-w-8 rounded-t-sm transition-all hover:opacity-80"
                    style={{
                      height: `${Math.max(pct, 2)}%`,
                      background:
                        s.color ?? DEFAULT_COLORS[si % DEFAULT_COLORS.length],
                    }}
                    title={`${s.name}: ${val.toLocaleString()}`}
                  />
                )
              })}
            </div>
            <span className="text-[10px] text-muted-foreground truncate w-full text-center">
              {label}
            </span>
          </div>
        ))}
      </div>

      {data.yAxisLabel && (
        <p className="mt-1 text-center text-[10px] text-muted-foreground/60">
          {data.yAxisLabel}
        </p>
      )}
    </div>
  )
}
