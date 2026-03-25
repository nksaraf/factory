import { useMemo } from "react"

import type { Block } from "../../../types"

interface LineChartData {
  title: string
  labels: string[]
  series: { name: string; values: number[]; color?: string }[]
  yAxisLabel?: string
}

const DEFAULT_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6"]

export function DashboardLineChart({ block }: { block: Block }) {
  const data = block.data as unknown as LineChartData

  const { minValue, maxValue } = useMemo(() => {
    let min = Infinity
    let max = -Infinity
    for (const s of data.series) {
      for (const v of s.values) {
        if (v < min) min = v
        if (v > max) max = v
      }
    }
    if (min === Infinity) return { minValue: 0, maxValue: 1 }
    const padding = (max - min) * 0.1
    return { minValue: min - padding, maxValue: max + padding }
  }, [data.series])

  const range = maxValue - minValue || 1
  const width = 400
  const height = 160
  const paddingX = 0
  const pointCount = data.labels.length

  function toSvgPath(values: number[]): string {
    if (values.length === 0) return ""
    const stepX = pointCount > 1 ? (width - paddingX * 2) / (pointCount - 1) : 0
    return values
      .map((v, i) => {
        const x = paddingX + i * stepX
        const y = height - ((v - minValue) / range) * height
        return `${i === 0 ? "M" : "L"} ${x} ${y}`
      })
      .join(" ")
  }

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <h3 className="text-sm font-medium text-muted-foreground">
        {data.title}
      </h3>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap gap-3">
        {data.series.map((s, i) => (
          <div key={s.name} className="flex items-center gap-1.5 text-xs">
            <div
              className="h-2.5 w-2.5 rounded-full"
              style={{
                background:
                  s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
              }}
            />
            <span className="text-muted-foreground">{s.name}</span>
          </div>
        ))}
      </div>

      {/* SVG chart */}
      <div className="mt-3">
        <svg
          viewBox={`0 0 ${width} ${height + 20}`}
          className="w-full"
          preserveAspectRatio="none"
        >
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((pct) => (
            <line
              key={pct}
              x1={0}
              y1={height * (1 - pct)}
              x2={width}
              y2={height * (1 - pct)}
              stroke="currentColor"
              className="text-border"
              strokeWidth={0.5}
            />
          ))}

          {/* Lines */}
          {data.series.map((s, i) => (
            <path
              key={s.name}
              d={toSvgPath(s.values)}
              fill="none"
              stroke={s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {/* Dots */}
          {data.series.map((s, i) => {
            const stepX =
              pointCount > 1 ? (width - paddingX * 2) / (pointCount - 1) : 0
            return s.values.map((v, vi) => {
              const cx = paddingX + vi * stepX
              const cy = height - ((v - minValue) / range) * height
              return (
                <circle
                  key={`${s.name}-${vi}`}
                  cx={cx}
                  cy={cy}
                  r={3}
                  fill={s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                >
                  <title>{`${s.name}: ${v.toLocaleString()}`}</title>
                </circle>
              )
            })
          })}

          {/* X labels */}
          {data.labels.map((label, i) => {
            const stepX =
              pointCount > 1 ? (width - paddingX * 2) / (pointCount - 1) : 0
            const x = paddingX + i * stepX
            return (
              <text
                key={label}
                x={x}
                y={height + 14}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize={10}
              >
                {label}
              </text>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
