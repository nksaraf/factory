import type { Block } from "../../../types"

interface StatGridData {
  title: string
  stats: { label: string; value: string | number; color?: string }[]
}

export function DashboardStatGrid({ block }: { block: Block }) {
  const data = block.data as unknown as StatGridData

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <h3 className="text-sm font-medium text-muted-foreground">
        {data.title}
      </h3>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {data.stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-md bg-muted/30 p-3 text-center"
          >
            <p
              className="text-lg font-bold tabular-nums"
              style={stat.color ? { color: stat.color } : undefined}
            >
              {typeof stat.value === "number"
                ? stat.value.toLocaleString()
                : stat.value}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
