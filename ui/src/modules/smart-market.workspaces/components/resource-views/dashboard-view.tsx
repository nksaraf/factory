import { useMemo } from "react"

import type { Block, ResourceDetail } from "../../types"
import { compareSortKeys } from "../../utils/sort-keys"
import { DashboardBarChart } from "./dashboard-widgets/bar-chart"
import { DashboardTable } from "./dashboard-widgets/data-table"
import { DashboardKpiCard } from "./dashboard-widgets/kpi-card"
import { DashboardLineChart } from "./dashboard-widgets/line-chart"
import { DashboardStatGrid } from "./dashboard-widgets/stat-grid"
import { DashboardTextBlock } from "./dashboard-widgets/text-block"

// ─── Block type → widget component mapping ──────────────────────────────────

const WIDGET_RENDERERS: Record<
  string,
  React.ComponentType<{ block: Block }>
> = {
  dashboard_kpi: DashboardKpiCard,
  dashboard_bar_chart: DashboardBarChart,
  dashboard_line_chart: DashboardLineChart,
  dashboard_table: DashboardTable,
  dashboard_stat_grid: DashboardStatGrid,
  dashboard_text: DashboardTextBlock,
}

// ─── Layout helpers ─────────────────────────────────────────────────────────

type ColSpan = 1 | 2 | 3 | 4

function getColSpan(block: Block): ColSpan {
  const span = block.data.colSpan as number | undefined
  if (span && span >= 1 && span <= 4) return span as ColSpan
  // Sensible defaults per widget type
  switch (block.blockType) {
    case "dashboard_kpi":
      return 1
    case "dashboard_bar_chart":
    case "dashboard_line_chart":
      return 2
    case "dashboard_table":
      return 4
    case "dashboard_stat_grid":
      return 4
    case "dashboard_text":
      return 4
    default:
      return 1
  }
}

const COL_SPAN_CLASS: Record<ColSpan, string> = {
  1: "col-span-1",
  2: "col-span-1 sm:col-span-2",
  3: "col-span-1 sm:col-span-2 lg:col-span-3",
  4: "col-span-1 sm:col-span-2 lg:col-span-4",
}

// ─── Dashboard view ─────────────────────────────────────────────────────────

export default function DashboardView({
  resource,
}: {
  resource: ResourceDetail
}) {
  const widgets = useMemo(() => {
    return resource.blocks
      .filter((b) => b.blockType.startsWith("dashboard_"))
      .sort((a, b) => compareSortKeys(a.sortKey, b.sortKey))
  }, [resource.blocks])

  if (widgets.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-muted-foreground">
        <p className="text-sm">No widgets configured for this dashboard.</p>
        <p className="text-xs text-muted-foreground/60">
          Add dashboard blocks to populate this view.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {widgets.map((block) => {
          const Renderer = WIDGET_RENDERERS[block.blockType]
          if (!Renderer) return null
          const span = getColSpan(block)
          return (
            <div key={block.id} className={COL_SPAN_CLASS[span]}>
              <Renderer block={block} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
