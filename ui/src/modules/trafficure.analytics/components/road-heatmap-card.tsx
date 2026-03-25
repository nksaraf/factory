import { useState, useMemo } from "react"
import { useParams } from "react-router"
import { ResponsiveHeatMap } from "@nivo/heatmap"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@rio.js/ui/select"
import { useRoadHeatmapQuery } from "../data/use-road-heatmap-query"
import { HOURS } from "../utils/heatmap-utils"

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const FULL_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

export function RoadHeatmapCard() {
  const { roadId } = useParams()
  const [timePeriod, setTimePeriod] = useState<7 | 15 | 30>(7)

  const { data } = useRoadHeatmapQuery(roadId, timePeriod)
  const { cells: heatmapData, patternRecognition } = data || { cells: [], patternRecognition: null }

  // Transform heatmap data to nivo format
  const nivoData = useMemo(() => {
    // Create a lookup map for existing data
    const dataMap = new Map<string, typeof heatmapData[0]>()
    if (heatmapData && heatmapData.length > 0) {
      heatmapData.forEach((item) => {
        const key = `${item.dayIndex}-${item.hour}`
        dataMap.set(key, item)
      })
    }

    // Get typical speed from first heatmap cell (all cells should have similar typical speed)
    // Fallback to 45 if not available
    const firstCell = heatmapData?.find((item) => item.raw.avgTypicalSpeedKmph !== null)
    const typicalSpeed = firstCell?.raw.avgTypicalSpeedKmph || 45

    // Create full 7x24 grid (all days and hours)
    const rows = Array.from({ length: 7 }, (_, dayIdx) => {
      const dayLabel = DAYS[dayIdx]
      const data = Array.from({ length: 24 }, (_, hour) => {
        const key = `${dayIdx}-${hour}`
        const item = dataMap.get(key)

        if (!item) {
          // No data available - return placeholder with null values
          return {
            x: String(hour),
            y: null as any,
            hour: hour,
            dayIdx: dayIdx,
            metricValue: null as any,
            raw: null,
            noData: true,
          }
        }

        // Check if the item has null values (road closed or no data)
        const hasNullData = item.raw.avgActualSpeedKmph === null || item.raw.delayPct === null
        
        if (hasNullData) {
          // Data exists but values are null - road is closed
          return {
            x: String(hour),
            y: null as any,
            hour: hour,
            dayIdx: dayIdx,
            metricValue: null as any,
            raw: item.raw,
            noData: true,
          }
        }

        const avgSpeed = item.raw.avgActualSpeedKmph || typicalSpeed

        return {
          x: String(hour),
          y: avgSpeed,
          hour: hour,
          dayIdx: dayIdx,
          metricValue: avgSpeed,
          raw: item.raw,
          noData: false,
        }
      })

      return {
        id: dayLabel,
        data,
      }
    })

    return rows
  }, [heatmapData])

  // Get busiest hour and day from API pattern recognition
  const busiestHour = useMemo(() => {
    if (!patternRecognition) return null
    const hour = patternRecognition.worstHour
    return `${String(hour).padStart(2, "0")}:00`
  }, [patternRecognition])

  const busiestDay = useMemo(() => {
    if (!patternRecognition) return null
    const dayIndex = patternRecognition.worstDay
    return FULL_DAY_NAMES[dayIndex] || null
  }, [patternRecognition])

  return (
    <div className="px-4 flex flex-col gap-2">
      <div className="rounded-lg border border-scale-500 bg-scale-100 p-4">
        <div className="flex flex-col gap-2">
          {/* Header with badges inline */}
          <div className="flex items-center justify-between gap-3 min-w-0">
            <h2 className="text-md font-semibold text-scale-1200 shrink-0">
              Busy Hours Pattern
            </h2>
            <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
              <Select
                value={timePeriod.toString()}
                onValueChange={(v) => setTimePeriod(parseInt(v) as 7 | 15 | 30)}
              >
                <SelectTrigger className="h-9 text-base min-w-0 flex-1 max-w-[140px] overflow-hidden">
                  <SelectValue className="truncate block" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7" className="text-base">Last 7 days</SelectItem>
                  <SelectItem value="15" className="text-base">Last 15 days</SelectItem>
                  <SelectItem value="30" className="text-base">Last 30 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Busiest hour and day - Major Focus */}
          {(busiestHour || busiestDay) && (
            <div className="flex justify-end mr-4">
              <div className="p-1 flex items-center gap-4">
              {busiestDay && (
                  <>
                    <div className="flex items-center gap-1">
                      <span className="text-base text-scale-1100">Busiest Day:</span>
                      <span className="text-base font-semibold text-yellow-600">
                        {busiestDay}
                      </span>
                    </div>
                  </>
                )}
                {busiestHour && (
                  <div className="flex items-center gap-1">
                    <span className="text-base text-scale-1100">Busiest Hour:</span>
                     <span className="text-base font-semibold text-red-600">
                      {busiestHour}
                    </span>
                  </div>
                )}

              </div>
            </div>
          )}

          {/* Weekly Heatmap */}
          <div className="flex flex-col gap-0 -mt-2">
            {nivoData.length > 0 && (
              <div className="h-[160px]">
                <ResponsiveHeatMap
                  data={nivoData as any}
                  margin={{ top: 20, right: 16, bottom: 20, left: 40 }}
                  theme={{
                    axis: {
                      ticks: {
                        text: {
                          fontSize: 12,
                          fill: "#64748B",
                        },
                      },
                    },
                  }}
                  valueFormat={(value) => {
                    // Don't show value for cells with no data
                    if (value == null || isNaN(Number(value))) return ""
                    const num = Number(value)
                    return `${num.toFixed(0)} km/h`
                  }}
                  axisTop={{
                    tickSize: 0,
                    tickPadding: 4,
                    tickRotation: 0,
                    legend: "",
                    legendOffset: 0,
                    tickValues: HOURS.filter((h) => h % 3 === 0).map((h) =>
                      String(h)
                    ),
                  }}
                  axisRight={null}
                  axisBottom={null}
                  axisLeft={{
                    tickSize: 0,
                    tickPadding: 4,
                    tickRotation: 0,
                  }}
                  colors={(cell: any) => {
                    const cellData = cell.data as any
                    // Check if this cell has no data
                    if (cellData?.noData === true) {
                      return "#d1d5db" // grey for no data
                    }
                    const value = Number(cell.value)
                    if (!Number.isFinite(value)) {
                      return "#e5e7eb"
                    }
                    
                    // Fixed speed ranges for traffic movement
                    // Less than 15 km/h - Red (severe congestion)
                    if (value < 15) {
                      return "#ef4444"
                    }
                    // 15-19 km/h - Yellow/Orange (heavy congestion)
                    else if (value >= 15 && value < 19) {
                      return "#fbbf24"
                    }
                    // 19-25 km/h - Light green (moderate)
                    else if (value >= 19 && value < 25) {
                      return "#86efac"
                    }
                    // Greater than 25 km/h - Green (good flow)
                    else {
                      return "#34d399"
                    }
                  }}
                  emptyColor="#e5e7eb"
                  borderWidth={2}
                  borderRadius={2}
                  borderColor="#ffffff"
                  enableLabels={false}
                  inactiveOpacity={0.5}
                  activeOpacity={1}
                  tooltip={({ cell }: any) => {
                    const data = cell.data as any
                    const dayLabel = DAYS[data.dayIdx % 7]
                    const hour = data.hour as number
                    const raw = data.raw
                    const noData = data.noData === true

                    return (
                      <div className="rounded-lg border border-scale-600 bg-scale-100 px-2 py-1.5 text-base shadow-lg max-w-[200px] z-[9999] relative">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="font-semibold text-scale-1200">
                            {dayLabel}
                          </div>
                          <div className="text-scale-1100">
                            {String(hour).padStart(2, "0")}:00
                          </div>
                        </div>

                        {noData ? (
                          <div className="text-base text-scale-1100">
                            <div className="font-semibold text-scale-1200">Road Closed</div>
                            <div>Data not available</div>
                          </div>
                        ) : (
                          <>
                            {raw && (
                              <>
                                <div className="flex items-center justify-between gap-2 text-base">
                                  <div className="text-scale-1100">Speed:</div>
                                  <div className="font-semibold text-scale-1200">
                                    {raw.avgActualSpeedKmph !== null ? raw.avgActualSpeedKmph.toFixed(0) : "--"} km/h
                                  </div>
                                </div>
                                {raw.avgTypicalSpeedKmph !== null && (
                                  <div className="flex items-center justify-between gap-2 text-base">
                                    <div className="text-scale-1100">
                                      Typical Speed:
                                    </div>
                                    <div className="font-semibold text-scale-1200">
                                      {raw.avgTypicalSpeedKmph.toFixed(0)} km/h
                                    </div>
                                  </div>
                                )}
                                {raw.delayPct !== null && (
                                  <div className="flex items-center justify-between gap-2 text-base">
                                    <div className="text-scale-1100">Delay:</div>
                                    <div className="font-semibold text-scale-1200">
                                      {raw.delayPct.toFixed(0)}%
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </>
                        )}
                      </div>
                    )
                  }}
                />
              </div>
            )}

            {/* Legend */}
            <div className="flex flex-col gap-2 pt-0">
              <div className="flex">
                <div className="w-[40px]" />
                <div className="flex-1 flex items-center gap-1">
                  <div className="flex-1 h-2 rounded-sm" style={{ background: "#ef4444" }} />
                  <div className="flex-1 h-2 rounded-sm" style={{ background: "#fbbf24" }} />
                  <div className="flex-1 h-2 rounded-sm" style={{ background: "#86efac" }} />
                  <div className="flex-1 h-2 rounded-sm" style={{ background: "#34d399" }} />
                </div>
                <div className="w-4" />
              </div>
              <div className="flex">
                <div className="w-[40px]" />
                <div className="flex-1 flex items-center justify-between text-xs text-scale-1100">
                  <span>&lt; 15 km/h</span>
                  <span>15-19 km/h </span>
                  <span>19-25 km/h </span>
                  <span>&gt; 25 km/h</span>
                </div>
                <div className="w-4" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

