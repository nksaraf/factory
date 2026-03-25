import { useState } from "react"
import { useParams, useNavigate } from "react-router"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@rio.js/ui/select"
import { Icon } from "@rio.js/ui/icon"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@rio.js/ui/tooltip"
import { useRoadAlertStatisticsQuery } from "../data/use-road-alert-statistics-query"
import { useRoadAlertsQuery } from "../../trafficure.core/data/road-alerts"

export function RoadAlertsCard() {
  const { roadId } = useParams()
  const navigate = useNavigate()
  const [timePeriod, setTimePeriod] = useState<7 | 15 | 30>(7)

  const { data: alertStats } = useRoadAlertStatisticsQuery(roadId, timePeriod)
  const { alerts } = useRoadAlertsQuery(roadId, 1) // Fetch the most recent active alert

  if (!alertStats || !alertStats.data) {
    return null
  }

  const { data } = alertStats
  const totalAlerts = data.alertCount
  const trendDirection = data.trend.raw.direction
  const trendPct = Math.abs(data.trend.raw.pct_change)
  const avgDurationMinutes = data.avgDuration.raw.avg_minutes
  const typeBreakdown = data.typeBreakdown
  const congestionCount = typeBreakdown.congestion || 0
  const rapidDeteriorationCount = typeBreakdown.surge || 0
  const mostAlertsOccur = data.mostAlertsOccur
  const longestAlertMinutes = data.longestAlertMinutes || 0

  // Get active alert details from the alerts query
  const activeAlertDetails = alerts.length > 0 && alerts[0].type === "active" ? alerts[0] : null

  // Calculate minutes ago for active alert (format as hours + minutes if > 60 min)
  const getMinutesAgo = (startedAt: string) => {
    const now = new Date()
    const alertTime = new Date(startedAt)
    const diffMs = now.getTime() - alertTime.getTime()
    const diffMinutes = Math.floor(diffMs / (1000 * 60))
    
    if (diffMinutes < 60) {
      return `${diffMinutes} min`
    }
    
    const hours = Math.floor(diffMinutes / 60)
    const mins = diffMinutes % 60
    
    if (mins === 0) {
      return `${hours}h`
    }
    
    return `${hours}h ${mins}m`
  }

  // Format alert type for display
  const getAlertTypeDisplay = (alertType: string) => {
    if (alertType === "RAPID_DETERIORATION") {
      return "Surge"
    } else if (alertType === "CONGESTION") {
      return "Congestion"
    }
    return alertType
  }

  // Format duration
  const formatDuration = (minutes: number) => {
    if (minutes < 60) {
      return `${Math.round(minutes)}m`
    }
    const hours = Math.floor(minutes / 60)
    const mins = Math.round(minutes % 60)
    return `${hours}h ${mins}m`
  }

  // Trend color and icon
  const getTrendConfig = () => {
    if (trendDirection === "down") {
      return {
        color: "text-emerald-600",
        label: "↓",
      }
    } else if (trendDirection === "up") {
      return {
        color: "text-red-600",
        label: "↑",
      }
    } else {
      return {
        color: "text-scale-600",
        label: "→",
      }
    }
  }

  const trendConfig = getTrendConfig()

  return (
    <div className="px-4 flex flex-col gap-2">
      <div className="rounded-lg border border-scale-500 bg-scale-100 p-4">
        <div className="flex flex-col gap-3">
          {/* Header with icon and time period selector */}
          <div className="flex items-center justify-between gap-3 min-w-0">
            <h2 className="text-md font-semibold text-scale-1200 shrink-0">
              Alert History
            </h2>
            <Select
              value={timePeriod.toString()}
              onValueChange={(v) => setTimePeriod(parseInt(v) as 7 | 15 | 30)}
            >
              <SelectTrigger className="h-9 text-base min-w-0 shrink max-w-[140px] overflow-hidden">
                <SelectValue className="truncate block" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7" className="text-base">Last 7 days</SelectItem>
                <SelectItem value="15" className="text-base">Last 15 days</SelectItem>
                <SelectItem value="30" className="text-base">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Hero Metric Section: Total Alerts */}
          <div className="flex justify-between items-stretch">
            <div className="flex flex-col">
              <div className="text-6xl font-bold text-scale-1200 leading-none">
                {totalAlerts}
              </div>
              <div className="text-base text-scale-1100 mt-2">
                alerts in last {timePeriod} days
              </div>
            </div>

            {/* Right side: Trend Indicator and Most Alerts Occur */}
            <div className="flex flex-col items-end gap-2">
              {trendPct > 0 && (
                <>
                  <div className={`text-lg font-bold leading-none ${trendConfig.color}`}>
                    {trendConfig.label}
                    {trendPct.toFixed(0)}%
                  </div>
                  <div className="flex items-center gap-1 text-base text-scale-1000">
                    {trendDirection === "up" ? "Trending up" : trendDirection === "down" ? "Trending down" : "Stable"}
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" className="inline-flex">
                            <Icon icon="icon-[ph--info]" className="text-icon-sm text-scale-1000 hover:text-scale-1200 mt-0" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p>Shows how much alerts have increased or decreased compared to the previous period</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </>
              )}
              {mostAlertsOccur && (
                <>
                  <div className="text-lg font-bold leading-none text-orange-600">
                    {mostAlertsOccur}
                  </div>
                  <div className="flex items-center gap-1 text-base text-scale-1000">
                    Most alerts occur
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" className="inline-flex">
                            <Icon icon="icon-[ph--info]" className="text-icon-sm text-scale-1000 hover:text-scale-1200 mt-0" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p>The time period when most alerts typically occur on this road</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Metrics Grid - 4 Cards */}
          <div className="rounded-lg border border-scale-500 bg-scale-100 overflow-hidden">
            <div className="grid grid-cols-2">
              {/* Average Duration */}
              <div className="border-scale-500 border-r border-b py-2.5 px-3 flex flex-col gap-0.5">
                <span className="text-sm text-scale-1000 leading-tight">Avg Duration</span>
                <span className="text-lg font-bold text-scale-1200 leading-tight">
                  {formatDuration(avgDurationMinutes)}
                </span>
              </div>

              {/* Longest Alert */}
              <div className="border-scale-500 border-b py-2.5 px-3 flex flex-col gap-0.5">
                <span className="text-sm text-scale-1000 leading-tight">Longest Alert</span>
                <span className="text-lg font-bold text-scale-1200 leading-tight">
                  {longestAlertMinutes > 0 ? formatDuration(longestAlertMinutes) : "—"}
                </span>
              </div>

              {/* Congestion Alerts Card */}
              <div className="border-scale-500 border-r py-2.5 px-3 flex flex-col gap-0.5">
                <span className="text-sm text-scale-1000 leading-tight">Congestion</span>
                <span className="text-lg font-bold text-red-600 leading-tight">
                  {congestionCount} {congestionCount === 1 ? "alert" : "alerts"}
                </span>
              </div>

              {/* Rapid Deterioration Alerts Card */}
              <div className="border-scale-500 py-2.5 px-3 flex flex-col gap-0.5">
                <span className="text-sm text-scale-1000 leading-tight">Surge</span>
                <span className="text-lg font-bold text-yellow-600 leading-tight">
                  {rapidDeteriorationCount} {rapidDeteriorationCount === 1 ? "alert" : "alerts"}
                </span>
              </div>
            </div>
          </div>

          {/* Active Alert Banner - End Placement */}
          {activeAlertDetails && (
            <button
              type="button"
              onClick={() => navigate(`/alerts/${activeAlertDetails.id}`)}
              className="flex items-center gap-3 rounded-lg p-2.5 shadow-sm border-2 w-full text-left transition-all hover:shadow-md hover:scale-[1.01] cursor-pointer bg-red-50 border-red-300 hover:bg-red-100"
            >
              <Icon
                icon="icon-[ph--warning-circle-fill]"
                className="text-2xl shrink-0 text-red-600"
              />
              <div className="flex flex-col min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-base font-bold uppercase tracking-wide text-red-900">
                    Active Alert
                  </span>
                  <span className="text-sm font-semibold whitespace-nowrap shrink-0 text-red-900">
                    {getMinutesAgo(activeAlertDetails.startedAt)} ago
                  </span>
                </div>
              </div>
              <Icon
                icon="icon-[ph--caret-right]"
                className="text-xl shrink-0 text-red-600"
              />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
