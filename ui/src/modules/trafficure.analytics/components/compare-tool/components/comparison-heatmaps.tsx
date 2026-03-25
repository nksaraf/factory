import { useState, useMemo } from "react"
import { ResponsiveHeatMap } from "@nivo/heatmap"
import { format } from "date-fns"
import { ComparisonResult } from "../types"
import { DAYS, HOURS, getHeatColorForCongestion } from "../../../utils/heatmap-utils"

interface ComparisonHeatmapsProps {
  result: ComparisonResult
  beforeStartDate: Date | null
  beforeEndDate: Date | null
  afterStartDate: Date | null
  afterEndDate: Date | null
}

export function ComparisonHeatmaps({ 
  result,
  beforeStartDate,
  beforeEndDate,
  afterStartDate,
  afterEndDate
}: ComparisonHeatmapsProps) {
  const [hoveredCell, setHoveredCell] = useState<{ day: number; hour: number } | null>(null)

  const formatDateRange = (start: Date | null, end: Date | null) => {
    if (!start || !end) return ""
    return `${format(start, "MMM d")} - ${format(end, "MMM d, yyyy")}`
  }

  const beforePeriod = formatDateRange(beforeStartDate, beforeEndDate)
  const afterPeriod = formatDateRange(afterStartDate, afterEndDate)

  // Transform heatmap data for Nivo format
  const transformHeatmapData = (heatmapData: typeof result.before.heatmapData) => {
    const dataByDay: Record<number, { id: string; data: Array<{ x: string; y: number }> }> = {}

    // Initialize days
    for (let day = 0; day < 7; day++) {
      dataByDay[day] = {
        id: DAYS[day],
        data: []
      }
    }

    // Populate data
    heatmapData.forEach(cell => {
      dataByDay[cell.day].data.push({
        x: String(cell.hour),
        y: cell.value
      })
    })

    return Object.values(dataByDay)
  }

  const beforeData = useMemo(() => transformHeatmapData(result.before.heatmapData), [result.before.heatmapData])
  const afterData = useMemo(() => transformHeatmapData(result.after.heatmapData), [result.after.heatmapData])

  // Calculate min/max for color scale
  const allValues = [
    ...result.before.heatmapData.map(c => c.value),
    ...result.after.heatmapData.map(c => c.value)
  ]
  const minValue = Math.min(...allValues)
  const maxValue = Math.max(...allValues)

  const getCellValue = (day: number, hour: number, data: typeof beforeData) => {
    const dayData = data.find(d => d.id === DAYS[day])
    if (!dayData) return null
    const cell = dayData.data.find(c => c.x === String(hour))
    return cell ? cell.y : null
  }

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-scale-1200">Side by Side Heatmaps</h3>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Before Period Heatmap */}
        <div className="space-y-2">
          <div className="flex items-center">
            <div className="w-[40px]" />
            <div className="flex-1 text-sm font-medium text-scale-1100">
              Before Period{beforePeriod && ` • ${beforePeriod}`}
            </div>
          </div>
          <div className="h-[400px] w-full">
            <ResponsiveHeatMap
              data={beforeData}
              margin={{ top: 20, right: 16, bottom: 20, left: 40 }}
              valueFormat=">-.2f"
              axisTop={{
                tickSize: 0,
                tickPadding: 4,
                tickRotation: 0,
                legend: "",
                legendOffset: 0,
                tickValues: HOURS.filter((h) => h % 3 === 0).map((h) => String(h))
              }}
              axisRight={null}
              axisLeft={{
                tickSize: 0,
                tickPadding: 4,
                tickRotation: 0,
              }}
              axisBottom={null}
              colors={(cell: any) => {
                const value = Number(cell.value)
                if (!Number.isFinite(value)) {
                  return "#e5e7eb"
                }
                if (maxValue === minValue) {
                  return "#fbbf24"
                }
                const range = maxValue - minValue || 1
                const normalizedValue = ((value - minValue) / range) * 100
                return getHeatColorForCongestion(normalizedValue, 0, 100)
              }}
              emptyColor="#e5e7eb"
              borderWidth={2}
              borderRadius={2}
              borderColor="#ffffff"
              enableLabels={false}
              inactiveOpacity={hoveredCell ? 0.5 : 1}
              activeOpacity={1}
              tooltip={({ cell }: any) => {
                const dayLabel = cell.serieId
                const hour = parseInt(cell.data.x)
                const beforeValue = getCellValue(
                  DAYS.indexOf(dayLabel as any),
                  hour,
                  beforeData
                )
                const afterValue = getCellValue(
                  DAYS.indexOf(dayLabel as any),
                  hour,
                  afterData
                )

                if (beforeValue === null || afterValue === null) return null

                const improvement = beforeValue - afterValue
                const improvementText = improvement > 0 
                  ? `improved by ${improvement.toFixed(0)} percentage points`
                  : improvement < 0
                  ? `worsened by ${Math.abs(improvement).toFixed(0)} percentage points`
                  : "unchanged"

                return (
                  <div className="rounded-lg border border-scale-600 bg-scale-100 px-2 py-1.5 text-[10px] shadow-lg max-w-[200px]">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="font-semibold text-scale-1200">
                        {dayLabel}
                      </div>
                      <div className="text-scale-1100">
                        {String(hour).padStart(2, "0")}:00
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[9px]">
                      <div className="text-scale-1100">Before:</div>
                      <div className="font-semibold text-scale-1200">
                        {beforeValue.toFixed(0)}%
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[9px]">
                      <div className="text-scale-1100">After:</div>
                      <div className="font-semibold text-scale-1200">
                        {afterValue.toFixed(0)}%
                      </div>
                    </div>
                    <div className="text-[9px] text-scale-1100 mt-1">
                      {improvementText}
                    </div>
                  </div>
                )
              }}
              onMouseEnter={(cell: any) => {
                const day = DAYS.indexOf(cell.serieId)
                const hour = parseInt(cell.data.x)
                setHoveredCell({ day, hour })
              }}
              onMouseLeave={() => setHoveredCell(null)}
            />
          </div>
        </div>

        {/* After Period Heatmap */}
        <div className="space-y-2">
          <div className="flex items-center">
            <div className="w-[40px]" />
            <div className="flex-1 text-sm font-medium text-scale-1100">
              After Period{afterPeriod && ` • ${afterPeriod}`}
            </div>
          </div>
          <div className="h-[400px] w-full">
            <ResponsiveHeatMap
              data={afterData}
              margin={{ top: 20, right: 16, bottom: 20, left: 40 }}
              valueFormat=">-.2f"
              axisTop={{
                tickSize: 0,
                tickPadding: 4,
                tickRotation: 0,
                legend: "",
                legendOffset: 0,
                tickValues: HOURS.filter((h) => h % 3 === 0).map((h) => String(h))
              }}
              axisRight={null}
              axisLeft={{
                tickSize: 0,
                tickPadding: 4,
                tickRotation: 0,
              }}
              axisBottom={null}
              colors={(cell: any) => {
                const value = Number(cell.value)
                if (!Number.isFinite(value)) {
                  return "#e5e7eb"
                }
                if (maxValue === minValue) {
                  return "#fbbf24"
                }
                const range = maxValue - minValue || 1
                const normalizedValue = ((value - minValue) / range) * 100
                return getHeatColorForCongestion(normalizedValue, 0, 100)
              }}
              emptyColor="#e5e7eb"
              borderWidth={2}
              borderRadius={2}
              borderColor="#ffffff"
              enableLabels={false}
              inactiveOpacity={hoveredCell ? 0.5 : 1}
              activeOpacity={1}
              tooltip={({ cell }: any) => {
                const dayLabel = cell.serieId
                const hour = parseInt(cell.data.x)
                const beforeValue = getCellValue(
                  DAYS.indexOf(dayLabel as any),
                  hour,
                  beforeData
                )
                const afterValue = getCellValue(
                  DAYS.indexOf(dayLabel as any),
                  hour,
                  afterData
                )

                if (beforeValue === null || afterValue === null) return null

                const improvement = beforeValue - afterValue
                const improvementText = improvement > 0 
                  ? `improved by ${improvement.toFixed(0)} percentage points`
                  : improvement < 0
                  ? `worsened by ${Math.abs(improvement).toFixed(0)} percentage points`
                  : "unchanged"

                return (
                  <div className="rounded-lg border border-scale-600 bg-scale-100 px-2 py-1.5 text-[10px] shadow-lg max-w-[200px]">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="font-semibold text-scale-1200">
                        {dayLabel}
                      </div>
                      <div className="text-scale-1100">
                        {String(hour).padStart(2, "0")}:00
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[9px]">
                      <div className="text-scale-1100">Before:</div>
                      <div className="font-semibold text-scale-1200">
                        {beforeValue.toFixed(0)}%
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[9px]">
                      <div className="text-scale-1100">After:</div>
                      <div className="font-semibold text-scale-1200">
                        {afterValue.toFixed(0)}%
                      </div>
                    </div>
                    <div className="text-[9px] text-scale-1100 mt-1">
                      {improvementText}
                    </div>
                  </div>
                )
              }}
              onMouseEnter={(cell: any) => {
                const day = DAYS.indexOf(cell.serieId)
                const hour = parseInt(cell.data.x)
                setHoveredCell({ day, hour })
              }}
              onMouseLeave={() => setHoveredCell(null)}
            />
          </div>
        </div>
      </div>

      {/* Single Shared Legend */}
      {/* <div className="flex flex-col gap-2 pt-0">
        <div className="flex justify-center">
          <div className="w-full max-w-md">
            <div
              className="w-full h-2 rounded-sm overflow-hidden"
              style={{
                background:
                  "linear-gradient(to right, #34d399 0%, #34d399 33%, #fbbf24 67%, #ef4444 100%)",
              }}
            />
          </div>
        </div>
        <div className="flex justify-center">
          <div className="w-full max-w-md flex items-center justify-between text-xs text-scale-1200">
            <span>Normal Flow</span>
            <span>Moderate</span>
            <span>Heavy Delay</span>
          </div>
        </div>
      </div> */}
    </div>
  )
}

