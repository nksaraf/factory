import {
  use,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react"
import { useLocation, useNavigate, useParams } from "react-router"

import { AuthUIContext } from "@rio.js/auth-ui/lib/auth-ui-context"
import { useAppState, useQueryClient } from "@rio.js/client"
import { env } from "@rio.js/env"
import { cn } from "@rio.js/ui"
import { Badge } from "@rio.js/ui/badge"
import { Button } from "@rio.js/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@rio.js/ui/dialog"
import { Icon } from "@rio.js/ui/icon"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rio.js/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rio.js/ui/table"
import { Textarea } from "@rio.js/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from "@rio.js/ui/tooltip"
import { toast } from "@rio.js/ui/use-toast"

import { isMobileAppDevice } from "../../lib/device-cookie"
import {
  ALERT_TYPE_COLORS,
  ALERT_TYPE_ICONS,
  ALERT_TYPE_LABELS,
} from "./alert-type-config"
import { type Alert, getAlertById } from "./alerts-data"
import { AlertNarrative } from "./components/alert-narrative"
import { AlertsQueryContext } from "./components/alerts-query-context"
import {
  CustomLineChart,
  type LineConfig,
  type ReferenceAreaConfig,
  type ReferenceLineConfig,
} from "./custom-line-chart"
import { useAlertsQuery } from "./data/alerts"
import { useHistoricalAlertsQuery } from "./data/historical-alerts"
import { useRoadAlertsQuery } from "./data/road-alerts"
import { useDismissAlert, useMarkGoodAlert } from "./data/use-alert-mutations"
import {
  type TrafficMetric,
  useTrafficMetrics,
} from "./data/use-traffic-metrics"
import { getAlertDurationText } from "./utils/alert-duration"
import { buildAlertNarrative } from "./utils/alert-narrative"
import {
  getAlertDurationMinutes,
  getAlertEndTime,
  getAlertStartTime,
} from "./utils/alert-timestamps"
import {
  formatDecimal,
  formatDelayWithPrefix,
  formatInteger,
} from "./utils/format-number"
import { formatTimeRange, formatTimeWithSmartDate } from "./utils/format-time"

// Check if alert history feature flag is enabled
const isAlertHistoryEnabled = env.PUBLIC_ENABLE_ALERT_HISTORY === "true"

// Check if analytics feature flag is enabled
const isAnalyticsEnabled = env.PUBLIC_ENABLE_ANALYTICS === "true"

// Helper function to format seconds to "Xm Ys" format
const formatTimeInMinutesSeconds = (seconds: number): string => {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`
  }
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  if (remainingSeconds === 0) {
    return `${minutes}m`
  }
  return `${minutes}m ${remainingSeconds}s`
}

// Map alert type labels to icon keys using centralized config
const getAlertTypeIconFromLabel = (alertTypeLabel: string): string => {
  if (alertTypeLabel === "Congestion") {
    return ALERT_TYPE_ICONS.CONGESTION
  } else {
    return ALERT_TYPE_ICONS.RAPID_DETERIORATION
  }
}

// Helper functions for callout styling
const ARROW = 6
const WIDTH = 90
const HEIGHT = 20
const RADIUS = 8

function getTransform(direction: "top" | "bottom" | "left" | "right") {
  switch (direction) {
    case "top":
      return `translate(${-WIDTH / 2}, ${-HEIGHT - ARROW - 6})`
    case "bottom":
      return `translate(${-WIDTH / 2}, ${ARROW + 6})`
    case "left":
      return `translate(${-WIDTH - ARROW - 6}, ${-HEIGHT / 2})`
    case "right":
      return `translate(${ARROW + 6}, ${-HEIGHT / 2})`
  }
}

function getArrowPath(
  direction: "top" | "bottom" | "left" | "right" | "top-right"
) {
  switch (direction) {
    case "top":
      return `M ${WIDTH / 2 - ARROW} ${HEIGHT}
              L ${WIDTH / 2} ${HEIGHT + ARROW}
              L ${WIDTH / 2 + ARROW} ${HEIGHT} Z`
    case "bottom":
      return `M ${WIDTH / 2 - ARROW} 0
              L ${WIDTH / 2} ${-ARROW}
              L ${WIDTH / 2 + ARROW} 0 Z`
    case "left":
      return `M ${WIDTH} ${HEIGHT / 2 - ARROW}
              L ${WIDTH + ARROW} ${HEIGHT / 2}
              L ${WIDTH} ${HEIGHT / 2 + ARROW} Z`
    case "right":
      return `M 0 ${HEIGHT / 2 - ARROW}
              L ${-ARROW} ${HEIGHT / 2}
              L 0 ${HEIGHT / 2 + ARROW} Z`
    case "top-right":
      return `
                  M ${WIDTH - RADIUS - 2} ${HEIGHT}
                  L ${WIDTH + ARROW} ${HEIGHT - ARROW - 2}
                  L ${WIDTH - 2} ${HEIGHT - RADIUS - 2}
                  Z
                `
  }
}

// Speed Trend Graph Component
function SpeedTrendGraph({
  metrics,
  alertStartTime,
  alertEndTime,
  windowStart,
  windowEnd,
  height = 200,
}: {
  metrics: TrafficMetric[]
  alertStartTime: Date
  alertEndTime: Date | null // null if alert is still active
  windowStart: Date
  windowEnd: Date
  expectedSpeed?: number
  height?: number
}) {
  // Use dynamic window for filtering metrics
  const now = new Date()

  // Transform metrics data to chart format
  // Filter to only include data within the dynamic window
  const filteredMetrics = metrics.filter((metric) => {
    const metricTime = new Date(metric.traffic_event_time)
    return metricTime >= windowStart && metricTime <= windowEnd
  })

  const sortedMetrics = [...filteredMetrics].sort(
    (a, b) =>
      new Date(a.traffic_event_time).getTime() -
      new Date(b.traffic_event_time).getTime()
  )

  const expectedSpeed =
    sortedMetrics[0]?.calculated_speed_kmph * sortedMetrics[0]?.saturation_index

  // Convert metrics directly to chart data points (no bucketing)
  const chartDataPoints = sortedMetrics.map((metric) => {
    const metricTime = new Date(metric.traffic_event_time)

    // Include date in time format to avoid duplicates across days
    const year = metricTime.getFullYear()
    const month = (metricTime.getMonth() + 1).toString().padStart(2, "0")
    const day = metricTime.getDate().toString().padStart(2, "0")
    const hours = metricTime.getHours().toString().padStart(2, "0")
    const minutes = metricTime.getMinutes().toString().padStart(2, "0")

    // Use full date-time string for uniqueness, but display only HH:MM in tooltips
    const timeKey = `${year}-${month}-${day} ${hours}:${minutes}`
    const displayTime = `${hours}:${minutes}`

    // Format with date for tooltip display in 24-hour format
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ]
    const monthName = monthNames[metricTime.getMonth()]
    const dayNum = metricTime.getDate()
    const fullDisplayTime = `${monthName} ${dayNum}, ${hours}:${minutes}`

    return {
      time: timeKey, // Use full date-time for uniqueness
      displayTime: displayTime, // Keep HH:MM for display
      fullDisplayTime: fullDisplayTime, // Date + time for tooltip
      actualSpeed: Math.round(metric.calculated_speed_kmph * 10) / 10,
      expectedSpeed: expectedSpeed,
      typicalSpeed:
        Math.round(metric.calculated_speed_kmph * metric.deviation_index * 10) /
        10,
      timestamp: metricTime.getTime(),
    }
  })

  // Check if alert start time is within the dynamic window
  const isStartTimeInWindow = alertStartTime >= windowStart
  const startTimestamp = alertStartTime.getTime()
  const endTimestamp = alertEndTime ? alertEndTime.getTime() : now.getTime()

  // Threshold for showing alert start marker: 90 seconds (1.5 minutes)
  // This ensures we only show the marker when there's a metric point close enough
  // to the actual alert time, avoiding misalignment for brand-new alerts
  const ALERT_START_TIME_THRESHOLD_MS = 90 * 1000 // 90 seconds

  // Find closest data point to start time (only if within window and threshold)
  let startDataPoint: (typeof chartDataPoints)[0] | null = null
  if (chartDataPoints.length > 0 && isStartTimeInWindow) {
    // Find the closest point to alert start time
    let closestPoint = chartDataPoints[0]
    let minDiff = Math.abs(chartDataPoints[0].timestamp - startTimestamp)

    for (const point of chartDataPoints) {
      const diff = Math.abs(point.timestamp - startTimestamp)
      if (diff < minDiff) {
        minDiff = diff
        closestPoint = point
      }
    }

    // Only use this point if it's within the threshold
    if (minDiff <= ALERT_START_TIME_THRESHOLD_MS) {
      startDataPoint = closestPoint
    }
    // Otherwise, startDataPoint remains null - no marker will be shown
  }

  // Find closest data point to end time
  let endDataPoint: (typeof chartDataPoints)[0] | null = null
  if (chartDataPoints.length > 0) {
    endDataPoint = chartDataPoints[chartDataPoints.length - 1]
    let minEndDiff = Math.abs(
      chartDataPoints[chartDataPoints.length - 1].timestamp - endTimestamp
    )
    for (const point of chartDataPoints) {
      const diff = Math.abs(point.timestamp - endTimestamp)
      if (diff < minEndDiff) {
        minEndDiff = diff
        endDataPoint = point
      }
    }
  }

  // Calculate dynamic Y-axis domain based on all data lines
  const allSpeeds: number[] = []
  chartDataPoints.forEach((point) => {
    if (point.actualSpeed > 0) allSpeeds.push(point.actualSpeed)
    if (point.expectedSpeed > 0) allSpeeds.push(point.expectedSpeed)
    if (point.typicalSpeed > 0) allSpeeds.push(point.typicalSpeed)
  })

  const minSpeed = allSpeeds.length > 0 ? Math.min(...allSpeeds) : 0
  const maxSpeed = allSpeeds.length > 0 ? Math.max(...allSpeeds) : 60

  // Nice rounding: round down min to nearest 10, round up max to nearest 10
  const roundedMin = Math.max(0, Math.floor(minSpeed / 10) * 10)
  const roundedMax = Math.ceil(maxSpeed / 10) * 10

  // Determine tick step (prefer 10, use 5 if range is tiny)
  const range = roundedMax - roundedMin
  const tickStep = range <= 20 ? 5 : 10

  // Generate Y-axis ticks
  const yAxisTicks: number[] = []
  for (let tick = roundedMin; tick <= roundedMax; tick += tickStep) {
    yAxisTicks.push(tick)
  }

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white border border-scale-700 rounded-lg p-2 shadow-lg">
          <p className="text-xs text-scale-1000 mb-1">
            {payload[0].payload.fullDisplayTime ||
              payload[0].payload.displayTime ||
              payload[0].payload.time}
          </p>
          <p className="text-xs text-scale-1200">
            Actual:{" "}
            <span className="text-red-600">
              {formatDecimal(payload[0].value)} km/h
            </span>
          </p>
          <p className="text-xs text-scale-1200">
            Typical:{" "}
            <span className="text-gray-500">
              {formatDecimal(payload[2].value)} km/h
            </span>
          </p>
          <p className="text-xs text-scale-1200">
            Free Flow:{" "}
            <span className="text-gray-500">
              {formatDecimal(payload[1].value)} km/h
            </span>
          </p>
        </div>
      )
    }
    return null
  }

  // Generate X-axis labels every 1 hour
  // Start from first hour boundary after windowStart (or nearest hour)
  const startHour = new Date(windowStart)
  startHour.setMinutes(0, 0, 0)
  // If windowStart is not exactly on the hour, move to next hour
  if (startHour.getTime() < windowStart.getTime()) {
    startHour.setHours(startHour.getHours() + 1)
  }

  // End at windowEnd hour (rounded down)
  const endHour = new Date(windowEnd)
  endHour.setMinutes(0, 0, 0)

  // Generate hour labels
  const xAxisHourLabels: string[] = []
  let currentHour = new Date(startHour)
  while (currentHour <= endHour) {
    const hours = currentHour.getHours().toString().padStart(2, "0")
    const minutes = currentHour.getMinutes().toString().padStart(2, "0")
    xAxisHourLabels.push(`${hours}:${minutes}`)
    currentHour = new Date(currentHour.getTime() + 60 * 60 * 1000) // Add 1 hour
  }

  // Create a map of data point times to their hour labels
  // Find the closest data point to each hour boundary
  const timeToHourLabelMap = new Map<string, string>()
  xAxisHourLabels.forEach((hourLabel) => {
    const [labelHours] = hourLabel.split(":").map(Number)

    // Create a date for the hour using windowStart as base date to handle cross-day scenarios
    const labelDate = new Date(windowStart)
    labelDate.setHours(labelHours, 0, 0, 0)

    // If the hour is before windowStart, it might be from the next day
    if (labelDate.getTime() < windowStart.getTime()) {
      labelDate.setDate(labelDate.getDate() + 1)
    }

    const labelTimestamp = labelDate.getTime()

    // Find closest data point to this hour
    let closestPoint = chartDataPoints[0]
    let minDiff = Math.abs(chartDataPoints[0].timestamp - labelTimestamp)
    for (const point of chartDataPoints) {
      const diff = Math.abs(point.timestamp - labelTimestamp)
      if (diff < minDiff) {
        minDiff = diff
        closestPoint = point
      }
    }

    // Map the data point time to the hour label
    timeToHourLabelMap.set(closestPoint.time, hourLabel)
  })

  // Get all the data point times that should show hour labels
  const xAxisTicks = Array.from(timeToHourLabelMap.keys())

  // Get speed values at start and end points for callouts
  const startSpeed = startDataPoint?.actualSpeed || 0

  // Format time for callouts (HH:MM format)
  const formatCalloutTime = (timeStr: string) => {
    // If it's a full date-time string, extract just the time portion
    if (timeStr.includes(" ")) {
      return timeStr.split(" ")[1] // Return HH:MM portion
    }
    return timeStr // Fallback to original string
  }

  // Custom dot component for start marker
  const StartDot = (props: any) => {
    const { cx, cy, payload } = props
    if (!startDataPoint || payload.time !== startDataPoint.time) return null

    return (
      <g transform={`translate(${cx}, ${cy})`}>
        {/* Anchor dot */}
        <circle r={3} fill="#ef4444" stroke="white" strokeWidth={2} />

        {/* Callout */}
        <g transform={getTransform("bottom")}>
          {/* Bubble */}
          <rect
            width={WIDTH}
            height={HEIGHT}
            rx={RADIUS}
            fill="white"
            stroke="#3b82f6"
            strokeWidth={1.2}
            filter="drop-shadow(0 2px 4px rgba(0,0,0,0.15))"
          />

          {/* Arrow */}
          <path
            d={getArrowPath("bottom")}
            fill="white"
            stroke="#3b82f6"
            strokeWidth={1.2}
          />

          {/* Text */}
          <text
            x={WIDTH / 2}
            y={HEIGHT / 2 + 4}
            textAnchor="middle"
            fontSize={10}
            fontWeight={600}
            fill="#1e40af"
          >
            {formatCalloutTime(
              startDataPoint.displayTime || startDataPoint.time
            )}{" "}
            - {formatDecimal(startSpeed)}km/h
          </text>
        </g>
      </g>
    )
  }

  // Build chart configuration
  const lines: LineConfig[] = [
    {
      dataKey: "actualSpeed",
      name: "Actual Speed",
      stroke: "#ef4444",
      strokeWidth: 2,
      dot: (props: any) => {
        // Show custom dot for start point only if startDataPoint exists (within threshold)
        if (
          isStartTimeInWindow &&
          startDataPoint &&
          props.payload?.time === startDataPoint.time
        ) {
          return <StartDot {...props} />
        }
        return null
      },
      activeDot: { r: 2 },
    },
    {
      dataKey: "expectedSpeed",
      name: "Free Flow Speed",
      stroke: "#9ca3af",
      strokeWidth: 2,
      strokeDasharray: "4 4",
      dot: false,
      activeDot: false,
    },
    {
      dataKey: "typicalSpeed",
      name: "Typical Speed",
      stroke: "#3b82f6",
      strokeWidth: 2,
      dot: false,
      activeDot: { r: 2 },
    },
  ]

  const referenceLines: ReferenceLineConfig[] = []

  // Vertical line for alert start time - only show if startDataPoint exists (within threshold)
  if (isStartTimeInWindow && startDataPoint) {
    referenceLines.push({
      type: "vertical",
      value: startDataPoint.time,
      stroke: "#ef4444",
      strokeWidth: 2,
      strokeDasharray: "4 4",
      label: { value: "", position: "top", fill: "#ef4444", fontSize: 11 },
    })
  }

  // Vertical line for alert end time (only if resolved)
  if (alertEndTime && endDataPoint) {
    referenceLines.push({
      type: "vertical",
      value: endDataPoint.time,
      stroke: "#ef4444",
      strokeWidth: 2,
      strokeDasharray: "4 4",
      label: { value: "", position: "top", fill: "#ef4444", fontSize: 11 },
    })
  }

  // Horizontal line for expected speed
  if (expectedSpeed) {
    referenceLines.push({
      type: "horizontal",
      value: expectedSpeed,
      stroke: "#9ca3af",
      strokeWidth: 2,
      strokeDasharray: "4 4",
      label: { value: "", position: "right", fill: "#9ca3af", fontSize: 11 },
    })
  }

  const referenceAreas: ReferenceAreaConfig[] = []
  // Only show reference area if startDataPoint exists (within threshold)
  if (startDataPoint) {
    referenceAreas.push({
      x1: startDataPoint.time,
      x2: endDataPoint.time || new Date().toISOString(),
      fill: "rgba(239, 68, 68, 0.15)",
      ifOverflow: "visible",
    })
  }

  // const areaFill: AreaFillConfig = {
  //   dataKey: "actualSpeed",
  //   fill: {
  //     type: "gradient",
  //     id: "speedAreaGradient",
  //     stops: [
  //       { offset: "0%", color: "rgba(239, 68, 68, 0.3)" },
  //       { offset: "100%", color: "rgba(239, 68, 68, 0.05)" },
  //     ],
  //   },
  //   fillOpacity: 1,
  // }

  return (
    <CustomLineChart
      data={chartDataPoints}
      lines={lines}
      referenceLines={referenceLines}
      referenceAreas={referenceAreas}
      // areaFill={areaFill}
      xAxis={{
        dataKey: "time",
        ticks: xAxisTicks,
        tickFormatter: (value) => {
          // First try to get the hour label from the map
          const hourLabel = timeToHourLabelMap.get(value)
          if (hourLabel) return hourLabel

          // Fallback: extract time portion if it's a full date-time string
          if (typeof value === "string" && value.includes(" ")) {
            return value.split(" ")[1] // Return HH:MM portion
          }

          return value
        },
      }}
      yAxis={{
        domain: [roundedMin, roundedMax],
        ticks: yAxisTicks,
      }}
      height={height}
      margin={{ top: 10, right: 45, bottom: 0, left: -14 }}
      tooltip={CustomTooltip}
      hideLegendOnMobile
      // defs={
      //   <linearGradient id="speedAreaGradient" x1="0" y1="0" x2="0" y2="1">
      //     <stop offset="0%" stopColor="rgba(239, 68, 68, 0.3)" />
      //     <stop offset="100%" stopColor="rgba(239, 68, 68, 0.05)" />
      //   </linearGradient>
      // }
    />
  )
}

export function AlertSidebarDetail() {
  const navigate = useNavigate()
  const { alertId } = useParams()
  const location = useLocation()

  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false)
  const [feedbackType, setFeedbackType] = useState<"good" | "dismiss" | null>(
    null
  )
  const [feedbackText, setFeedbackText] = useState("")
  const [alertHistoryLimit, setAlertHistoryLimit] = useState<string>("3")
  const [, startTransition] = useTransition()

  // Timer state to trigger re-renders for real-time duration updates
  // Updates every minute to keep duration displays synchronized
  const [currentMinute, setCurrentMinute] = useState(() =>
    Math.floor(Date.now() / 60000)
  )
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentMinute(Math.floor(Date.now() / 60000))
    }, 60000) // Update every minute

    return () => clearInterval(interval)
  }, [])

  // Header ref for measuring height
  const headerRef = useRef<HTMLDivElement>(null)

  // Snap points state
  const [, setSnapPoint] = useAppState<{
    snapPoints: (number | string)[]
    activeSnapPoint: number | string
  }>("main-drawer.snap-points", {
    snapPoints: ["56px", 0.9],
    activeSnapPoint: "56px",
  })

  // Measure header height and update snap points
  // Include drawer handle height: h-1 (4px) + my-2 (16px) = 20px
  const DRAWER_HANDLE_HEIGHT = 20
  useLayoutEffect(() => {
    if (headerRef.current) {
      const headerHeight = headerRef.current.offsetHeight + DRAWER_HANDLE_HEIGHT
      setSnapPoint({
        snapPoints: [`${headerHeight}px`, 0.9],
        activeSnapPoint: `${headerHeight}px`,
      })
    }
  }, [setSnapPoint])

  const queryClient = useQueryClient()
  const {
    hooks: { useActiveOrganization },
  } = use(AuthUIContext)
  const { data: activeOrganization } = useActiveOrganization()

  // Get query context for filters and sort (with null check)
  const alertsContext = useContext(AlertsQueryContext)

  // Get source tab from navigation state (which panel user clicked from)
  const sourceTab = (location.state as any)?.sourceTab as
    | "live"
    | "resolved"
    | undefined

  // Get filters, sort, and count/timeRange from context (with defaults) - separate for live and historical
  const liveFilters = alertsContext?.liveFilters || {}
  const historicalFilters = alertsContext?.historicalFilters || {}
  const liveSort = alertsContext?.liveSort || {
    key: "delay_seconds",
    sortOrder: "desc",
  }
  const historicalSort = alertsContext?.historicalSort || {
    key: "resolved_at",
    sortOrder: "desc",
  }
  const liveCount = alertsContext?.liveCount ?? null
  const historicalTimeRange = alertsContext?.historicalTimeRange ?? "1h"

  // Fetch alerts from API (both live and historical) with filters, sort, and count/timeRange
  const { alerts: liveAlerts } = useAlertsQuery(
    liveFilters,
    liveSort,
    liveCount
  )
  const { alerts: historicalAlerts } = useHistoricalAlertsQuery(
    historicalFilters,
    historicalSort,
    historicalTimeRange
  )

  const { alerts: liveAlertsFallback } = useAlertsQuery()
  // Use wider time range (2 days) for fallback to find alerts that might be outside current selection
  const { alerts: historicalAlertsFallback } = useHistoricalAlertsQuery(
    {},
    historicalSort,
    "2d"
  )

  // Prioritize alerts based on source tab:
  // - If from "resolved" tab, prioritize historical alerts
  // - If from "live" tab or unknown, prioritize live alerts
  // This prevents showing stale data when transitioning between states
  const allAlerts =
    sourceTab === "resolved"
      ? [...historicalAlerts, ...liveAlerts] // Historical first (resolved panel)
      : [...liveAlerts, ...historicalAlerts] // Live first (live panel or default)

  // Fallback alerts (without count limit) for finding alerts that might be filtered out
  const allAlertsFallback =
    sourceTab === "resolved"
      ? [...historicalAlertsFallback, ...liveAlertsFallback]
      : [...liveAlertsFallback, ...historicalAlertsFallback]

  // Try to find alert in limited results first, then fallback to unlimited results
  const alert = alertId
    ? getAlertById(alertId, allAlerts) ||
      getAlertById(alertId, allAlertsFallback)
    : null

  // Keep previous alert data during refetch to prevent panel from closing
  const prevAlertRef = useRef<Alert | null>(null)
  // Prevent duplicate "no longer available" toasts
  const missingToastShownRef = useRef(false)
  useEffect(() => {
    if (alert) {
      prevAlertRef.current = alert
    }
  }, [alert])

  // Use current alert or previous alert (for smooth transitions during refetch)
  const displayAlert = alert || prevAlertRef.current

  // Invalidate queries when alert changes to ensure fresh data
  useEffect(() => {
    if (!displayAlert) return

    // Always invalidate BOTH active and historical queries
    // Using partial query keys to invalidate ALL combinations (filters, sort, count, etc.)
    // React Query will match all queries that start with the provided prefix
    if (activeOrganization?.id) {
      // Invalidate all historical query combinations for this organization
      queryClient.invalidateQueries({
        queryKey: [activeOrganization.id, "alerts", "historical"],
        exact: false, // Match all queries starting with this prefix
      })
      // Invalidate all active query combinations for this organization
      queryClient.invalidateQueries({
        queryKey: [activeOrganization.id, "alerts", "active"],
        exact: false, // Match all queries starting with this prefix
      })
      // Invalidate all road alerts query combinations for this organization
      queryClient.invalidateQueries({
        queryKey: [activeOrganization.id, "alerts", "road"],
        exact: false, // Match all queries starting with this prefix
      })
    }
    // Also invalidate queries without organization ID (fallback)
    queryClient.invalidateQueries({
      queryKey: ["alerts", "historical"],
      exact: false, // Match all queries starting with this prefix
    })
    queryClient.invalidateQueries({
      queryKey: ["alerts", "active"],
      exact: false, // Match all queries starting with this prefix
    })
    queryClient.invalidateQueries({
      queryKey: ["alerts", "road"],
      exact: false, // Match all queries starting with this prefix
    })
  }, [
    displayAlert?.id,
    displayAlert?.type,
    queryClient,
    activeOrganization?.id,
  ])

  // Navigate away if alert is truly not found (after giving it a chance to refetch)
  useEffect(() => {
    if (alert) {
      // Reset toast flag when alert is available again
      missingToastShownRef.current = false
    }

    if (alertId && !alert && prevAlertRef.current) {
      // Alert was found before but not now - wait a bit to see if it refetches
      const timer = setTimeout(() => {
        // Check both limited and fallback (unlimited) results
        const currentAlert =
          getAlertById(alertId, allAlerts) ||
          getAlertById(alertId, allAlertsFallback)
        if (!currentAlert) {
          // Alert is truly gone, navigate away
          if (!missingToastShownRef.current) {
            toast({
              title: "Alert no longer available",
              description: "It may have been resolved or filtered out.",
              variant: "warning",
            })
            missingToastShownRef.current = true
          }
          navigate("/alerts")
        }
      }, 1000) // Wait 1 second for refetch
      return () => clearTimeout(timer)
    } else if (alertId && !alert && !prevAlertRef.current) {
      // Never found this alert, navigate away immediately
      if (!missingToastShownRef.current) {
        toast({
          title: "Alert no longer available",
          description: "It may have been resolved or filtered out.",
          variant: "warning",
        })
        missingToastShownRef.current = true
      }
      navigate("/alerts")
    }
  }, [alertId, alert, allAlerts, allAlertsFallback, navigate])

  // Calculate dynamic time window with adaptive padding based on alert duration
  // If alert duration < 40 minutes: use 30 minutes padding on each side
  // If alert duration >= 40 minutes: use 1 hour padding on each side
  const windowStart = useMemo(() => {
    if (!displayAlert) {
      return null
    }

    const alertStartTime = getAlertStartTime(displayAlert)
    const alertEndTime = getAlertEndTime(displayAlert)

    // Calculate alert duration in minutes
    let durationMinutes: number | null = null
    if (alertEndTime) {
      // Resolved alert: use actual duration
      durationMinutes = getAlertDurationMinutes(displayAlert)
    } else {
      // Active alert: calculate duration from start to now
      const now = new Date()
      const durationMs = now.getTime() - alertStartTime.getTime()
      durationMinutes = Math.floor(durationMs / (60 * 1000))
    }

    // Determine padding: 30 minutes if duration < 40 minutes, otherwise 1 hour
    const paddingMinutes =
      durationMinutes !== null && durationMinutes < 40 ? 30 : 60

    const windowStart = new Date(alertStartTime)
    windowStart.setMinutes(windowStart.getMinutes() - paddingMinutes)
    windowStart.setSeconds(0, 0)

    return windowStart
  }, [
    displayAlert?.startedAt,
    displayAlert?.resolvedAt,
    displayAlert?.type,
    Math.floor(Date.now() / 60000),
  ])

  // Memoize windowEnd - dynamic based on alert status and duration
  // For resolved alerts: alertEndTime + padding (30 min or 1 hour based on duration)
  // For active alerts: max(current time, alertStartTime + padding) to ensure minimum window
  const windowEnd = useMemo(() => {
    if (!displayAlert) {
      const now = new Date()
      now.setSeconds(0, 0)
      return now
    }

    const alertStartTime = getAlertStartTime(displayAlert)
    const alertEndTime = getAlertEndTime(displayAlert)

    // Calculate alert duration in minutes
    let durationMinutes: number | null = null
    if (alertEndTime) {
      // Resolved alert: use actual duration
      durationMinutes = getAlertDurationMinutes(displayAlert)
    } else {
      // Active alert: calculate duration from start to now
      const now = new Date()
      const durationMs = now.getTime() - alertStartTime.getTime()
      durationMinutes = Math.floor(durationMs / (60 * 1000))
    }

    // Determine padding: 30 minutes if duration < 40 minutes, otherwise 1 hour
    const paddingMinutes =
      durationMinutes !== null && durationMinutes < 40 ? 30 : 60

    if (alertEndTime) {
      // Alert is resolved: set window end to alert end time + padding
      const windowEnd = new Date(alertEndTime)
      windowEnd.setMinutes(windowEnd.getMinutes() + paddingMinutes)
      windowEnd.setSeconds(0, 0)
      return windowEnd
    } else {
      // Alert is active: use max of current time or alertStartTime + padding
      // This ensures we show at least the padding amount of data even for very recent alerts
      const now = new Date()
      now.setSeconds(0, 0)

      const minEndTime = new Date(alertStartTime)
      minEndTime.setMinutes(minEndTime.getMinutes() + paddingMinutes)
      minEndTime.setSeconds(0, 0)

      return now > minEndTime ? now : minEndTime
    }
  }, [
    displayAlert?.id,
    displayAlert?.type,
    displayAlert?.resolvedAt,
    displayAlert?.startedAt,
    Math.floor(Date.now() / 60000), // Update every minute for active alerts
  ])

  // Fetch traffic metrics for the road with dynamic window
  const {
    data: trafficMetrics,
    isLoading: isLoadingMetrics,
  }: { data: TrafficMetric[]; isLoading: boolean } = useTrafficMetrics(
    displayAlert?.roadId || null,
    windowStart,
    windowEnd
  )

  // Mutation hooks
  const dismissAlert = useDismissAlert()
  const markGoodAlert = useMarkGoodAlert()

  const isLoading = dismissAlert.isPending || markGoodAlert.isPending

  // Fetch alert history for this road
  // Must be called before early return to satisfy Rules of Hooks
  const limit =
    alertHistoryLimit === "all" ? 1000 : parseInt(alertHistoryLimit, 10)
  const { alerts: roadAlerts } = useRoadAlertsQuery(
    displayAlert?.roadId || null,
    limit
  )

  // Transform road alerts to alert history table format
  // Always show the same top 3 most recent alerts for the road, regardless of which alert is selected
  // Include currentMinute in dependencies to trigger recalculation when time updates
  const alertHistory = useMemo(() => {
    if (!displayAlert || !roadAlerts.length) {
      return []
    }

    // Use centralized labels
    const typeLabels = ALERT_TYPE_LABELS

    // Transform to table format - don't filter out current alert, show all top 3
    const history = roadAlerts
      .map((alert) => {
        // Use utility functions for clear separation of start/end times
        const startTime = getAlertStartTime(alert) // Alert start time (from alert_event_time)
        const endTime = getAlertEndTime(alert) // Alert end time (from timestamp if resolved, null if active)

        // Helper to format duration based on total milliseconds
        const formatDuration = (durationMs: number): string => {
          const durationMinutes = Math.floor(durationMs / (60 * 1000))

          if (durationMinutes < 1) {
            // Less than 1 minute: show 0m for consistency with rest of UI
            return "0m"
          }

          if (durationMinutes < 60) {
            // Between 1 minute and less than 60 minutes: show minutes
            return `${durationMinutes}m`
          }

          // 60 minutes or more: show hours and remaining minutes
          const hours = Math.floor(durationMinutes / 60)
          const minutes = Math.floor(durationMinutes % 60)
          return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
        }

        // Calculate duration
        let totalTime: string
        if (endTime) {
          // Resolved alert: duration from start to end
          // Floor both times to the minute to match displayed times, then calculate difference
          const startMinutes = Math.floor(startTime.getTime() / (60 * 1000))
          const endMinutes = Math.floor(endTime.getTime() / (60 * 1000))
          const durationMinutes = endMinutes - startMinutes
          totalTime = formatDuration(durationMinutes * 60 * 1000)
        } else {
          // Active alert - calculate duration from start to now
          // Use currentMinute to ensure real-time updates
          const now = new Date()
          const startMinutes = Math.floor(startTime.getTime() / (60 * 1000))
          const nowMinutes = Math.floor(now.getTime() / (60 * 1000))
          const durationMinutes = nowMinutes - startMinutes
          totalTime = formatDuration(durationMinutes * 60 * 1000)
        }

        return {
          alertId: alert.id, // Include alertId to check if it matches current alert
          startTime: startTime.toISOString(),
          endTime: endTime ? endTime.toISOString() : null,
          totalTime,
          alertType: typeLabels[alert.alertType] || alert.alertType,
        }
      })
      // Sort by start time (most recent first)
      .sort(
        (a, b) =>
          new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
      )
      // Limit based on selected count (or show all if "all" is selected)
      .slice(
        0,
        alertHistoryLimit === "all"
          ? roadAlerts.length
          : parseInt(alertHistoryLimit, 10)
      )

    return history
  }, [displayAlert, roadAlerts, alertHistoryLimit, currentMinute]) // Include currentMinute to trigger updates

  // Don't render if no alert is selected
  if (!displayAlert || !alertId) {
    return null
  }

  // Use centralized config for labels, colors, and icons
  const alertText = ALERT_TYPE_LABELS[displayAlert.alertType]
  const alertTypeIcon = ALERT_TYPE_ICONS[displayAlert.alertType]
  const alertTypeColors = ALERT_TYPE_COLORS[displayAlert.alertType]

  // Use shared duration calculation utility
  const { durationText } = getAlertDurationText(displayAlert)
  const isResolved = displayAlert.type === "resolved" && displayAlert.resolvedAt

  // Determine alert status for badge
  const alertStatus: "active" | "suppressed" | "resolved" =
    displayAlert.type || "active"
  const statusConfig = {
    active: {
      label: "Active",
      variant: "destructive" as const,
      className: "bg-red-100 text-red-700 border-red-300",
    },
    suppressed: {
      label: "Suppressed",
      variant: "outline" as const,
      className: "bg-gray-100 text-gray-700 border-gray-300",
    },
    resolved: {
      label: "Resolved",
      variant: "secondary" as const,
      className: "bg-green-100 text-green-700 border-green-300",
    },
  } as const
  const status = statusConfig[alertStatus] || statusConfig.active

  // Calculate congestion factor
  const congestionFactor =
    displayAlert.deviationIndex || displayAlert.saturationIndex
  const congestionText = `${congestionFactor.toFixed(1)}x Slower`

  // NOTE: If we later want to show "resolved X mins ago" or average speed for resolved alerts,
  // compute them here and render in the UI. Removed for now to keep data flow clean.

  const handleGoodAlertClick = () => {
    setFeedbackType("good")
    setIsFeedbackModalOpen(true)
  }

  const handleDismissClick = () => {
    setFeedbackType("dismiss")
    setIsFeedbackModalOpen(true)
  }

  const handleFeedbackSubmit = async () => {
    if (!feedbackType || !displayAlert) return

    try {
      const alertId = parseInt(displayAlert.id, 10)
      if (isNaN(alertId)) {
        console.error("Invalid alert ID:", alert.id)
        return
      }

      if (feedbackType === "dismiss") {
        await dismissAlert.mutateAsync({
          alertId,
          feedbackText: feedbackText.trim() || undefined,
        })
      } else if (feedbackType === "good") {
        await markGoodAlert.mutateAsync({
          alertId,
          feedbackText: feedbackText.trim() || undefined,
        })
      }

      // Close dialog on success
      setIsFeedbackModalOpen(false)
      setFeedbackText("")
      setFeedbackType(null)
      // Navigate back to alerts list after action
      navigate("/alerts")
    } catch (error) {
      console.error("Failed to submit feedback:", error)
      // Optionally show an error message to the user
    }
  }

  const handleFeedbackCancel = () => {
    setIsFeedbackModalOpen(false)
    setFeedbackText("")
    setFeedbackType(null)
  }

  return (
    <>
      <div className="h-full flex flex-col bg-scale-100 overflow-hidden">
        {/* Header */}
        <div
          ref={headerRef}
          className="px-6 py-3 border-b bg-white border-scale-500 flex flex-col gap-1.5 relative rounded-t-lg"
        >
          <div className="flex flex-row items-center justify-between gap-0">
            <h1 className="text-xl font-bold text-scale-1200">
              {displayAlert.location}
            </h1>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/alerts")}
              className="shrink-0 text-scale-1200 hover:text-scale-1200"
              icon="icon-[ph--x]"
            />
          </div>
          {/* Date/Time Range */}
          <div className="text-scale-1100 text-base flex flex-col gap-1">
            {isResolved && displayAlert.resolvedAt ? (
              <div className="flex flex-col gap-1">
                <span>
                  {formatTimeWithSmartDate(displayAlert.startedAt)} →{" "}
                  {formatTimeWithSmartDate(displayAlert.resolvedAt)} (
                  {durationText.replace("Went on for ", "")})
                </span>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs font-medium inline-flex items-center gap-1.5",
                      status.className
                    )}
                  >
                    <Icon
                      icon="icon-[ph--check-circle-duotone]"
                      className="text-icon-sm"
                    />
                    {status.label}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="text-xs font-medium inline-flex items-center gap-1.5 bg-scale-100 text-scale-1200 border-scale-500"
                  >
                    <Icon icon="icon-[ph--ruler]" className="text-icon-sm" />
                    {(() => {
                      const length = displayAlert.roadLength || 0
                      return length >= 1000
                        ? `${formatDecimal(length / 1000)} km`
                        : `${formatInteger(length)} m`
                    })()}
                  </Badge>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <span>
                  {formatTimeWithSmartDate(displayAlert.startedAt)} → Ongoing (
                  {durationText.replace("Ongoing for ", "")})
                </span>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs font-medium inline-flex items-center gap-1.5",
                      alertTypeColors?.bgLight,
                      alertTypeColors?.textDark,
                      alertTypeColors?.border
                    )}
                  >
                    {alertTypeIcon && (
                      <Icon icon={alertTypeIcon} className="text-icon-sm" />
                    )}
                    {alertText}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="text-xs font-medium inline-flex items-center gap-1.5 bg-scale-100 text-scale-1200 border-scale-500"
                  >
                    <Icon icon="icon-[ph--ruler]" className="text-icon-sm" />
                    {(() => {
                      const length = displayAlert.roadLength || 0
                      return length >= 1000
                        ? `${formatDecimal(length / 1000)} km`
                        : `${formatInteger(length)} m`
                    })()}
                  </Badge>
                </div>
              </div>
            )}
          </div>
          {/* Status badge and action buttons in bottom right */}
          <div className="absolute bottom-2 right-6 flex items-center gap-2">
            {/* Analytics button - Show for both live and resolved alerts, only if analytics is enabled */}
            {isAnalyticsEnabled &&
              displayAlert?.roadId &&
              !isMobileAppDevice() && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        navigate(`/analytics/${displayAlert.roadId}`)
                      }
                      className="h-8 w-8 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-100"
                    >
                      <Icon
                        icon="icon-[ph--arrow-square-out-duotone]"
                        className="text-icon-lg"
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipPortal>
                    <TooltipContent>View road analytics</TooltipContent>
                  </TooltipPortal>
                </Tooltip>
              )}
            {/* Action buttons - Only show for active alerts */}
            {!isResolved && (
              <div className="flex items-center gap-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleGoodAlertClick}
                      disabled={isLoading}
                      className="h-8 w-8 text-brand-600 hover:text-brand-700 hover:bg-brand-100"
                    >
                      <Icon
                        icon="icon-[ph--thumbs-up-duotone]"
                        className="text-icon-lg"
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipPortal>
                    <TooltipContent>Good alert</TooltipContent>
                  </TooltipPortal>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleDismissClick}
                      disabled={isLoading}
                      className="h-8 w-8 text-destructive-600 hover:text-destructive-700 hover:bg-destructive-100"
                    >
                      <Icon
                        icon="icon-[ph--thumbs-down-duotone]"
                        className="text-icon-lg"
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipPortal>
                    <TooltipContent>Dismiss alert</TooltipContent>
                  </TooltipPortal>
                </Tooltip>
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <div
          className="flex-1 min-h-0 overflow-y-auto pretty-scroll flex flex-col gap-4 bg-[#EAEDF2] pb-2"
          data-vaul-no-drag
        >
          {/* Alert Summary */}
          <div className="flex flex-col gap-4 pt-4">
            {/* Recovering Stage Banner */}
            {!isResolved &&
              displayAlert.impactCostSec !== null &&
              displayAlert.impactCostSec <= 0 && (
                <div className="px-4">
                  <div className="rounded-lg border border-blue-500 bg-blue-50 p-3 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-blue-700 italic pl-1 ">
                      The road is about to recover very soon
                    </span>
                    <Icon
                      icon="icon-[ph--check-circle-duotone]"
                      className="text-icon-lg text-blue-600"
                    />
                  </div>
                </div>
              )}
            {/* Alert Summary - Hide when in recovering stage */}
            {!(
              !isResolved &&
              displayAlert.impactCostSec !== null &&
              displayAlert.impactCostSec <= 0
            ) && (
              <div className="px-4">
                <div className="rounded-lg border border-scale-500 bg-scale-100 p-4">
                  <div className="flex flex-col gap-3">
                    <h2 className="text-base font-semibold text-scale-1200">
                      {isResolved
                        ? "Alert Resolution Summary"
                        : "Alert Summary"}
                    </h2>
                    {/* Narrative */}
                    <AlertNarrative
                      tokens={buildAlertNarrative(displayAlert, trafficMetrics)}
                    />

                    {/* Additional metrics for resolved alerts */}
                    {/* {isResolved && (
                <div className="flex flex-col gap-2 pt-2 border-t border-scale-500">
                  <div className="text-sm text-scale-1100">
                    <span className="text-scale-1000">Average speed:</span>{" "}
                    <span className="font-medium text-scale-1200">
                      {averageSpeed !== null
                        ? `${formatDecimal(averageSpeed)} km/h`
                        : `${formatInteger(displayAlert.liveSpeedKmph || 0)} km/h`}
                    </span>
                  </div>
                  <div className="text-sm text-scale-1100">
                    <span className="text-scale-1000">Total delay:</span>{" "}
                    <span className="font-medium text-scale-1200">
                      +{formatInteger(displayAlert.impactMinutes || 0)} mins
                    </span>
                  </div>
                </div>
              )} */}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Key Metrics - 4 Cards (only for active alerts) */}
          {!isResolved && (
            <div className="px-4">
              <div className="rounded-lg border border-scale-500 bg-scale-100 overflow-hidden">
                <div className="grid grid-cols-2">
                  {/* Current Delay Card */}
                  <div className="border-scale-500 border-r border-b p-4 flex flex-col gap-1">
                    <span className="text-xs text-scale-1000">
                      Current Delay
                    </span>
                    <span className="text-2xl font-bold text-red-600">
                      {formatDelayWithPrefix(displayAlert.impactCostSec)}
                    </span>
                    <span className="text-xs text-scale-1000 italic">
                      more than usual
                    </span>
                  </div>

                  {/* Travel Time Card */}
                  <div className="border-scale-500 p-4 border-b flex flex-col gap-1">
                    <span className="text-xs text-scale-1000">Travel Time</span>
                    <span className="text-2xl font-bold text-scale-1200 ">
                      {displayAlert.currentTravelTimeSec !== undefined
                        ? formatTimeInMinutesSeconds(
                            displayAlert.currentTravelTimeSec
                          )
                        : "—"}
                    </span>
                    {displayAlert.typicalTimeSec !== undefined && (
                      <span className="text-xs text-scale-1000 italic">
                        vs{" "}
                        {formatTimeInMinutesSeconds(
                          displayAlert.typicalTimeSec
                        )}{" "}
                        (Typical)
                      </span>
                    )}
                  </div>

                  {/* Congestion Factor Card */}
                  <div className="border-scale-500 p-4 border-r flex flex-col gap-1">
                    <span className="text-xs text-scale-1000">
                      <span className="sm:hidden">Current Congestion</span>
                      <span className="hidden sm:inline">
                        Current Congestion Factor
                      </span>
                    </span>
                    <span className="text-2xl font-bold text-amber-600">
                      {congestionText}
                    </span>
                    <span className="text-xs text-scale-1000 italic">
                      than usual
                    </span>
                  </div>

                  {/* Traffic Speed Card */}
                  <div className="border-scale-500 p-4 flex flex-col gap-1">
                    <span className="text-xs text-scale-1000">
                      Current Traffic Speed
                    </span>
                    <span className="text-2xl font-bold text-scale-1200">
                      {formatInteger(displayAlert.liveSpeedKmph || 0)} km/h
                    </span>
                    <span className="text-xs text-scale-1000 italic">
                      vs{" "}
                      {formatInteger(
                        displayAlert.liveSpeedKmph *
                          displayAlert.saturationIndex
                      )}{" "}
                      km/h (Free Flow)
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Speed Trend Graph */}
          <div className="flex flex-col gap-4">
            <div className="px-4">
              <div className="rounded-lg border border-scale-500 bg-scale-100 p-4">
                <div className="flex flex-col gap-4">
                  <h2 className="text-base font-semibold text-scale-1200">
                    Speed Trend
                  </h2>
                  <div>
                    {isLoadingMetrics ? (
                      <div className="flex items-center justify-center h-[320px]">
                        <p className="text-sm text-scale-1000">
                          Loading chart data...
                        </p>
                      </div>
                    ) : (
                      <SpeedTrendGraph
                        metrics={trafficMetrics}
                        alertStartTime={getAlertStartTime(displayAlert)}
                        alertEndTime={getAlertEndTime(displayAlert)}
                        windowStart={windowStart || new Date()}
                        windowEnd={windowEnd}
                        height={320}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Alert History Table */}
          {isAlertHistoryEnabled && (
            <div className="flex flex-col gap-4">
              <div className="px-4">
                <div className="rounded-lg border border-scale-500 bg-scale-100 p-4">
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-base font-semibold text-scale-1200">
                        Alert History
                      </h2>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-scale-1100 whitespace-nowrap hidden sm:inline">
                          Count:
                        </span>
                        <Select
                          value={alertHistoryLimit}
                          onValueChange={(value) => {
                            startTransition(() => {
                              setAlertHistoryLimit(value)
                            })
                          }}
                        >
                          <SelectTrigger className="w-[90px] sm:w-[100px] h-8">
                            <SelectValue placeholder="Limit..." />
                          </SelectTrigger>
                          <SelectContent className="z-[50000]">
                            <SelectItem value="3">Last 3 </SelectItem>
                            <SelectItem value="5">Last 5</SelectItem>
                            <SelectItem value="10">Last 10</SelectItem>
                            <SelectItem value="20">Last 20</SelectItem>
                            <SelectItem value="50">Last 50</SelectItem>
                            <SelectItem value="100">Last 100</SelectItem>
                            <SelectItem value="all">All</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="border border-scale-500 rounded-lg overflow-hidden relative z-0">
                      <Table className="relative z-0">
                        <TableHeader>
                          <TableRow className="bg-scale-200 border-b border-scale-500">
                            <TableHead className="text-[11px] text-scale-1000 font-medium py-2.5 px-3 text-center">
                              Type
                            </TableHead>
                            <TableHead className="hidden sm:table-cell text-[11px] text-scale-1000 font-medium py-2.5 px-3 text-center">
                              Duration
                            </TableHead>
                            <TableHead className="text-[11px] text-scale-1000 font-medium py-2.5 px-3 text-center">
                              Time
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {alertHistory.map((alert) => {
                            // Use centralized config for badge styling
                            const getAlertTypeBadgeStyle = () => {
                              if (
                                alert.alertType === ALERT_TYPE_LABELS.CONGESTION
                              ) {
                                return `${ALERT_TYPE_COLORS.CONGESTION.bgLight} text-orange-700 border-orange-200`
                              } else if (
                                alert.alertType ===
                                ALERT_TYPE_LABELS.RAPID_DETERIORATION
                              ) {
                                return `${ALERT_TYPE_COLORS.RAPID_DETERIORATION.bgLight} text-red-700 border-red-200`
                              } else {
                                return "bg-gray-50 text-gray-700 border-gray-200"
                              }
                            }

                            const getAlertTypeIconStyle = () => {
                              if (
                                alert.alertType === ALERT_TYPE_LABELS.CONGESTION
                              ) {
                                return ALERT_TYPE_COLORS.CONGESTION.textDark
                              } else if (
                                alert.alertType ===
                                ALERT_TYPE_LABELS.RAPID_DETERIORATION
                              ) {
                                return ALERT_TYPE_COLORS.RAPID_DETERIORATION
                                  .textDark
                              } else {
                                return "text-gray-600"
                              }
                            }

                            const getAlertTypeLabel = () => {
                              // alert.alertType here is already the label string from typeLabels
                              return alert.alertType || "Alert"
                            }

                            // Check if this alert is the currently selected one
                            const isSelected =
                              alert.alertId === displayAlert?.id

                            return (
                              <TableRow
                                key={alert.alertId}
                                className={cn(
                                  "border-b border-scale-400 last:border-b-0 hover:bg-scale-200/50 transition-colors",
                                  isSelected && "bg-blue-100 shadow-sm"
                                )}
                              >
                                <TableCell className="py-2 px-3 text-center">
                                  <div
                                    className={cn(
                                      "inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-medium",
                                      getAlertTypeBadgeStyle()
                                    )}
                                  >
                                    <Icon
                                      icon={getAlertTypeIconFromLabel(
                                        alert.alertType
                                      )}
                                      className={cn(
                                        "text-icon-xs",
                                        getAlertTypeIconStyle()
                                      )}
                                    />
                                    <span>{getAlertTypeLabel()}</span>
                                  </div>
                                </TableCell>
                                <TableCell className="hidden sm:table-cell text-[13px] text-scale-1200 font-medium py-2 px-3 text-center tabular-nums">
                                  {alert.totalTime}
                                </TableCell>
                                <TableCell className="text-[13px] text-scale-1100 py-2 px-3 text-center tabular-nums">
                                  {alert.endTime ? (
                                    <span className="text-scale-1200">
                                      {formatTimeRange(
                                        alert.startTime,
                                        alert.endTime
                                      )}
                                    </span>
                                  ) : (
                                    <>
                                      <span className="text-scale-1200">
                                        {formatTimeWithSmartDate(
                                          alert.startTime
                                        )}
                                      </span>
                                      <span className="text-scale-900 mx-1.5">
                                        →
                                      </span>
                                      <span className="text-green-600 font-medium">
                                        Ongoing
                                      </span>
                                    </>
                                  )}
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Root Cause Analysis */}
          {/* <div className="flex flex-col gap-2">
            <div className="flex flex-row items-center gap-2">
              <h2 className="text-base font-bold text-scale-1200">
                Root Cause Analysis (Gemini)
              </h2>
              <Icon
                icon="icon-[ph--sparkle-duotone]"
                className="text-icon-sm text-blue-400"
              />
            </div>
            <div className="bg-white border border-scale-700 rounded-lg p-4">
              <p className="text-sm text-scale-1100">{alert.reason}</p>
            </div>
          </div> */}
        </div>
      </div>

      <Dialog open={isFeedbackModalOpen} onOpenChange={setIsFeedbackModalOpen}>
        <DialogContent className="max-w-2xl w-full">
          <DialogHeader>
            <DialogTitle>
              {feedbackType === "good"
                ? "What did you like about this alert?"
                : "Why are you dismissing this alert?"}
            </DialogTitle>
            <DialogDescription>
              Your feedback helps us improve our alert system.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Textarea
              placeholder="Share your thoughts..."
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              className="min-h-[100px]"
            />
          </DialogBody>
          <DialogFooter className="gap-3">
            <Button
              variant="outline"
              onClick={handleFeedbackCancel}
              disabled={isLoading}
              className="rounded-md px-6 py-2 font-medium"
            >
              Cancel
            </Button>
            <Button
              onClick={handleFeedbackSubmit}
              disabled={isLoading}
              className="rounded-md px-6 py-2 font-medium shadow-sm"
            >
              {isLoading ? "Submitting..." : "Submit Feedback"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
