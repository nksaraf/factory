import { useState, useMemo } from "react"
import { useParams } from "react-router"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@rio.js/ui/select"
import { useRoadTrendQuery } from "../data/use-road-trend-query"
import { formatDecimal } from "../../trafficure.core/utils/format-number"
import {
  CustomLineChart,
  type ChartDataPoint,
  type LineConfig,
  type AreaFillConfig,
} from "../../trafficure.core/custom-line-chart"
export function RoadTrendCard() {
  const { roadId } = useParams()
  const [timePeriod, setTimePeriod] = useState<1 | 3 | 7 | 15 | 30>(7)
  const [metricType, setMetricType] = useState<"speed" | "delay">("speed")

  const { data: trendData } = useRoadTrendQuery(roadId, timePeriod, "auto", metricType)

  // Transform trend data to chart format
  const { chartData, primaryColor } = useMemo(() => {
    if (!trendData || trendData.length === 0) {
      return { chartData: [], primaryColor: "rgb(16, 185, 129)" }
    }

    const points = trendData.map((item) => {
      const dateObj = new Date(item.timestamp)

      // Use values directly from trend data - they already include typical and free-flow speeds
      const freeFlowSpeed = item.speedFreeflowKmph
      const typicalSpeed = item.speedTypicalKmph

      const actualDelayPercent =
        freeFlowSpeed > 0
          ? ((freeFlowSpeed - item.speedActualKmph) / freeFlowSpeed) * 100
          : 0
      const typicalDelayPercent =
        freeFlowSpeed > 0
          ? ((freeFlowSpeed - typicalSpeed) / freeFlowSpeed) * 100
          : 0

      return {
        time: item.timestamp,
        timestamp: dateObj.getTime(),
        actualSpeed: item.speedActualKmph,
        typicalSpeed: item.speedTypicalKmph,
        freeFlowSpeed: item.speedFreeflowKmph,
        delayPercent: Math.max(0, actualDelayPercent),
        typicalDelayPercent: Math.max(0, typicalDelayPercent),
        freeFlowDelayPercent: 0,
      } as ChartDataPoint & {
        actualSpeed: number
        typicalSpeed: number
        freeFlowSpeed: number
        delayPercent: number
        typicalDelayPercent: number
        freeFlowDelayPercent: number
      }
    })

    // Determine trend color (mock: check if last value is lower than first)
    const firstSpeed = points[0]?.actualSpeed || 0
    const lastSpeed = points[points.length - 1]?.actualSpeed || 0
    const isDegrading = lastSpeed < firstSpeed * 0.95
    const primaryColor = isDegrading
      ? "rgb(220, 38, 38)"
      : "rgb(16, 185, 129)"

    return { chartData: points, primaryColor }
  }, [trendData])

  if (!trendData || trendData.length === 0) {
    return (
      <div className="px-4 flex flex-col gap-2">
        <div className="rounded-lg border border-scale-500 bg-scale-100 p-4">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 min-w-0">
              <h2 className="text-md font-semibold text-scale-1200 shrink-0">
                Trend Analysis
              </h2>
              <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
                <Select
                  value={timePeriod.toString()}
                  onValueChange={(v) =>
                    setTimePeriod(parseInt(v) as 1 | 3 | 7 | 15 | 30)
                  }
                >
                  <SelectTrigger className="h-9 text-base min-w-0 flex-1 max-w-[140px] overflow-hidden">
                    <SelectValue className="truncate block" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1" className="text-base">Last 1 day</SelectItem>
                    <SelectItem value="3" className="text-base">Last 3 days</SelectItem>
                    <SelectItem value="7" className="text-base">Last 7 days</SelectItem>
                    <SelectItem value="15" className="text-base">Last 15 days</SelectItem>
                    <SelectItem value="30" className="text-base">Last 30 days</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={metricType}
                  onValueChange={(v) => setMetricType(v as "speed" | "delay")}
                >
                  <SelectTrigger className="h-9 text-base min-w-0 flex-1 max-w-[140px] overflow-hidden">
                    <SelectValue className="truncate block" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="speed" className="text-base">Speed</SelectItem>
                    <SelectItem value="delay" className="text-base">Delay</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="text-base text-scale-1100 text-center py-8">
              No data available for the selected time period
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Determine Y-axis domain
  const metricValues =
    metricType === "speed"
      ? chartData.flatMap((p) => [
          p.actualSpeed,
          p.typicalSpeed,
          p.freeFlowSpeed,
        ])
      : chartData.flatMap((p) => [
          p.delayPercent,
          p.typicalDelayPercent,
          p.freeFlowDelayPercent,
        ])

  const filteredMetricValues = metricValues.filter(
    (v) => typeof v === "number" && isFinite(v as number)
  ) as number[]

  const rawMin =
    filteredMetricValues.length > 0 ? Math.min(...filteredMetricValues) : 0
  const rawMax =
    filteredMetricValues.length > 0 ? Math.max(...filteredMetricValues) : 0

  const roundedMin =
    metricType === "speed"
      ? Math.max(0, Math.floor(rawMin / 10) * 10)
      : 0
  const roundedMax =
    metricType === "speed"
      ? Math.ceil(rawMax / 10) * 10
      : Math.ceil(rawMax / 10) * 10 || 10

  const lines: LineConfig[] =
    metricType === "speed"
      ? [
          {
            dataKey: "actualSpeed",
            name: "Actual Speed",
            stroke: primaryColor,
            strokeWidth: 2,
            dot: false,
            activeDot: { r: 3 },
          },
          {
            dataKey: "typicalSpeed",
            name: "Typical Speed",
            stroke: "#3b82f6",
            strokeWidth: 2,
            strokeDasharray: "4 4",
            dot: false,
            activeDot: false,
          },
          {
            dataKey: "freeFlowSpeed",
            name: "Free Flow Speed",
            stroke: "#9ca3af",
            strokeWidth: 2,
            strokeDasharray: "4 4",
            dot: false,
            activeDot: false,
          },
        ]
      : [
          {
            dataKey: "delayPercent",
            name: "Actual Delay",
            stroke: primaryColor,
            strokeWidth: 2,
            dot: false,
            activeDot: { r: 3 },
          },
        ]

  const areaFill: AreaFillConfig = {
    dataKey: metricType === "speed" ? "actualSpeed" : "delayPercent",
    fill:
      primaryColor === "rgb(220, 38, 38)"
        ? "rgba(220, 38, 38, 0.18)"
        : "rgba(16, 185, 129, 0.18)",
    fillOpacity: 1,
  }

  const TrendTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null
    const point = payload[0].payload as {
      time: string
      timestamp: number
      actualSpeed: number
      typicalSpeed: number
      freeFlowSpeed?: number
      delayPercent: number
      typicalDelayPercent: number
      freeFlowDelayPercent: number
    }

    const date = new Date(point.timestamp)
    const day = date.getDate()
    const month = date.toLocaleDateString("en-US", { month: "short" })
    const year = date.getFullYear()
    const hours = date.getHours().toString().padStart(2, "0")
    const minutes = date.getMinutes().toString().padStart(2, "0")

    return (
      <div className="bg-white border border-scale-700 rounded-lg p-2 shadow-lg max-w-[220px]">
        <p className="text-base text-scale-1000 mb-1">
          {`${day} ${month} ${year}, ${hours}:${minutes}`}
        </p>
        {metricType === "speed" && (
          <>
            <p className="text-base text-scale-1200">
              Actual:{" "}
              <span className="text-red-600">
                {formatDecimal(point.actualSpeed)} km/h
              </span>
            </p>
            <p className="text-base text-scale-1200">
              Typical:{" "}
              <span className="text-gray-500">
                {formatDecimal(point.typicalSpeed)} km/h
              </span>
            </p>
            {point.freeFlowSpeed && (
              <p className="text-base text-scale-1200">
                Free Flow:{" "}
                <span className="text-gray-500">
                  {formatDecimal(point.freeFlowSpeed)} km/h
                </span>
              </p>
            )}
          </>
        )}
        {metricType === "delay" && (
          <p className="text-base text-scale-1200">
            Delay:{" "}
            <span className="text-red-600">
              {formatDecimal(point.delayPercent)}%
            </span>
          </p>
        )}
      </div>
    )
  }

  // For shorter durations, track which dates we've already shown
  let lastShownDate: string | null = null
  
  const formatXAxisLabel = (value: string) => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value

    const day = date.getDate()
    const month = date.toLocaleDateString("en-US", {
      month: "short",
    })
    const currentDate = `${day} ${month}`

    // For shorter time periods (1-3 days), show date only when it changes, otherwise show time
    if (timePeriod <= 3) {
      const hours = date.getHours().toString().padStart(2, "0")
      const minutes = date.getMinutes().toString().padStart(2, "0")
      
      if (lastShownDate !== currentDate) {
        lastShownDate = currentDate
        return currentDate
      }
      return `${hours}:${minutes}`
    }
    
    // For longer periods, show date
    return currentDate
  }

  // Limit x-axis ticks to at most ~7 evenly spaced labels
  const maxXTicks = 7
  const xAxisTicks: string[] = []

  if (chartData.length <= maxXTicks) {
    for (const p of chartData) {
      xAxisTicks.push(p.time as string)
    }
  } else {
    const step = Math.max(
      1,
      Math.floor((chartData.length - 1) / (maxXTicks - 1))
    )
    for (let i = 0; i < chartData.length; i += step) {
      xAxisTicks.push(chartData[i].time as string)
    }
    const lastTime = chartData[chartData.length - 1].time as string
    if (xAxisTicks[xAxisTicks.length - 1] !== lastTime) {
      xAxisTicks[xAxisTicks.length - 1] = lastTime
    }
  }

  return (
    <div className="px-4 flex flex-col gap-2">
      <div className="rounded-lg border border-scale-500 bg-scale-100 p-4">
        <div className="flex flex-col gap-4">
          {/* Header */}
            <div className="flex items-center justify-between gap-3 min-w-0">
              <h2 className="text-md font-semibold text-scale-1200 shrink-0">
                Trend Analysis
              </h2>
              <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
                <Select
                  value={timePeriod.toString()}
                  onValueChange={(v) => setTimePeriod(parseInt(v) as 1 | 3 | 7 | 15 | 30)}
                >
                  <SelectTrigger className="h-9 text-base min-w-0 flex-1 max-w-[140px] overflow-hidden">
                    <SelectValue className="truncate block" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1" className="text-base">Last 1 day</SelectItem>
                    <SelectItem value="3" className="text-base">Last 3 days</SelectItem>
                    <SelectItem value="7" className="text-base">Last 7 days</SelectItem>
                    <SelectItem value="15" className="text-base">Last 15 days</SelectItem>
                    <SelectItem value="30" className="text-base">Last 30 days</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={metricType}
                  onValueChange={(v) => setMetricType(v as "speed" | "delay")}
                >
                  <SelectTrigger className="h-9 text-base min-w-0 flex-1 max-w-[140px] overflow-hidden">
                    <SelectValue className="truncate block" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="speed" className="text-base">Speed</SelectItem>
                    <SelectItem value="delay" className="text-base">Delay</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

          {/* Chart */}
          <div className="h-56">
            <CustomLineChart
              data={chartData}
              lines={lines}
              areaFill={areaFill}
              xAxis={{
                dataKey: "time",
                ticks: xAxisTicks,
                tickFormatter: formatXAxisLabel,
              }}
              yAxis={{
                domain: [roundedMin, roundedMax],
                tickFormatter: (value: number) => {
                  if (value === 0) return ""
                  const formatted = value.toFixed(0)
                  return metricType === "speed"
                    ? `${formatted}\u00A0km/h`
                    : `${formatted}%`
                },
              }}
              height={220}
              margin={{
                top: 10,
                right: 20,
                bottom: 0,
                left: 0,
              }}
              tooltip={TrendTooltip}
              hideLegendOnMobile
            />
          </div>
        </div>
      </div>
    </div>
  )
}

