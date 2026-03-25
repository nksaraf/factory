import {
  ChangeEvent,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react"
import { useLocation, useNavigate } from "react-router"

import { useCurrentOrganization } from "@rio.js/auth-ui/hooks/use-current-organization"
import { useAppState, useRio } from "@rio.js/client"
import { env } from "@rio.js/env"
import { Icon, Icons } from "@rio.js/ui/icon"
import { Input } from "@rio.js/ui/input"
import { cn } from "@rio.js/ui/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rio.js/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@rio.js/ui/tabs"
import { toast } from "@rio.js/ui/use-toast"

import { isMobileAppDevice } from "../../lib/device-cookie"
import { AlertCard } from "./alert-card"
import { AlertInboxSkeleton } from "./alert-card-skeleton"
import { ALERT_TYPE_CONFIG } from "./alert-type-config"
import { type Alert } from "./alerts-data"
import {
  AlertsQueryContext,
  type HistoricalTimeRange,
} from "./components/alerts-query-context"
import { useAlertsQuery } from "./data/alerts"
import { useHistoricalAlertsQuery } from "./data/historical-alerts"
import { useRealtimeAlerts } from "./data/realtime-alerts"
import { formatDecimal } from "./utils/format-number"

// Check if resolve alerts feature flag is enabled
const isResolveAlertsEnabled = env.PUBLIC_ENABLE_RESOLVE_ALERTS === "true"

// Include drawer handle height: h-1 (4px) + my-2 (16px) = 20px
const DRAWER_HANDLE_HEIGHT = 20
const EXTRA_SNAP_HEIGHT = 20

// Re-export for backward compatibility
export const alertTypeConfig = ALERT_TYPE_CONFIG

// Sort options for live alerts
const LIVE_SORT_OPTIONS = [
  { value: "deviation_index", label: "Severity" },
  { value: "delay_seconds", label: "Delay" },
  { value: "duration", label: "Duration" },
  { value: "started_at", label: "Start Time" },
] as const

// Sort options for resolved alerts
const RESOLVED_SORT_OPTIONS = [
  { value: "resolved_at", label: "End Time" },
  { value: "duration", label: "Duration" },
  { value: "started_at", label: "Start Time" },
] as const

// Count options for live alerts
const LIVE_COUNT_OPTIONS = [
  { value: "10", label: "Top 10" },
  { value: "20", label: "Top 20" },
  { value: "50", label: "Top 50" },
  { value: "100", label: "Top 100" },
  { value: "all", label: "All" },
] as const

// Time range options for historical/resolved alerts
const HISTORICAL_TIME_RANGE_OPTIONS = [
  { value: "20m", label: "Last 20 mins" },
  { value: "1h", label: "Last 1 hr" },
  { value: "6h", label: "Last 6 hrs" },
  { value: "1d", label: "Last 1 day" },
  { value: "2d", label: "Last 2 days" },
] as const

// Simple mini-graph component (kept for detail view)
export function MiniGraph({
  data,
  height = 35,
  width = 160,
  color = "red",
}: {
  data: number[]
  color?: string
  height?: number
  width?: number
}) {
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1

  const colorClass =
    {
      red: "stroke-red-500",
      orange: "stroke-orange-500",
      yellow: "stroke-yellow-500",
    }[color] || "stroke-red-500"

  const fillColorClass =
    {
      red: "fill-red-500/20",
      orange: "fill-orange-500/20",
      yellow: "fill-yellow-500/20",
    }[color] || "fill-red-500/20"

  // Normalize data to 0-1 range
  const normalized = data.map((v) => (v - min) / range)
  const padding = 2

  const points = normalized
    .map((val, i) => {
      const x =
        padding + (i / (normalized.length - 1 || 1)) * (width - padding * 2)
      const y = padding + (1 - val) * (height - padding * 2)
      return `${x},${y}`
    })
    .join(" ")

  const areaPoints = `M${padding},${height - padding} L${points.split(" ").join(" L")} L${
    width - padding
  },${height - padding} Z`

  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={areaPoints} className={fillColorClass} stroke="none" />
      <polyline
        points={points}
        fill="none"
        strokeWidth="1.5"
        className={colorClass}
      />
    </svg>
  )
}

// Ghost Bar visualization component
// Shows historical median time (grey) vs current travel time (colored)
export function GhostBar({
  historicalMedianTime,
  currentTravelTime,
  color = "red",
  width = 160,
  height = 20,
}: {
  historicalMedianTime: number // seconds
  currentTravelTime: number // seconds
  color?: string
  width?: number
  height?: number
}) {
  // Grey bar represents historical median (fixed at 30% width)
  const greyBarWidth = width * 0.3
  // Colored bar scales relative to grey bar
  const ratio = currentTravelTime / historicalMedianTime
  const coloredBarWidth = Math.min(greyBarWidth * ratio, width)

  const colorClass =
    {
      red: "bg-red-500",
      orange: "bg-orange-500",
      yellow: "bg-yellow-500",
    }[color] || "bg-red-500"

  return (
    <div className="flex flex-col gap-1" style={{ width }}>
      {/* Grey bar (historical median) */}
      <div
        className="bg-scale-400 rounded-sm"
        style={{ width: greyBarWidth, height }}
      />
      {/* Colored bar (current travel time) */}
      <div
        className={cn("rounded-sm", colorClass)}
        style={{ width: coloredBarWidth, height }}
      />
    </div>
  )
}

// Generate dynamic status text based on alert type and metrics
export function getDynamicStatusText(alert: Alert): string {
  const { alertType, persistence, liveSpeedKmph, saturationIndex } = alert

  const currentSpeed = liveSpeedKmph

  let statusText = ""

  switch (alertType) {
    case "CONGESTION":
      const persistenceText =
        persistence && persistence > 15
          ? `Stopped >${Math.floor(persistence)} mins`
          : persistence && persistence >= 8
            ? `Stopped ${Math.floor(persistence)}+ mins`
            : currentSpeed && currentSpeed < 5
              ? "Stopped"
              : "Traffic Halted"

      // Use saturationIndex as a proxy for queue/backup
      const queueText = saturationIndex
        ? `Saturation ${formatDecimal(saturationIndex)}x`
        : "Queue Forming"

      statusText = `${persistenceText} • ${queueText}`
      break

    case "RAPID_DETERIORATION":
      const speedText =
        currentSpeed !== undefined && currentSpeed === 0
          ? "0 km/h flow"
          : currentSpeed && currentSpeed < 5
            ? `${Math.floor(currentSpeed)} km/h flow`
            : "Slow flow"

      statusText = `Rapid Slowdown • ${speedText}`
      break

    default:
      statusText = "Traffic Alert"
  }

  return statusText
}

function EmptyState({ isResolved = false }: { isResolved?: boolean }) {
  return (
    <div className="flex items-start justify-center h-full px-4 py-4">
      <div className="text-center p-8 rounded-lg border-2 border-dashed border-scale-700 bg-scale-300 shadow-sm max-w-md w-full">
        <h3 className="mt-4 text-lg font-semibold text-scale-1200">
          {isResolved ? "No resolved alerts" : "No alerts found"}
        </h3>
        <p className="mt-2 text-sm text-scale-1100">
          {isResolved
            ? "There are no resolved alerts in the past 20 minutes. Resolved alerts will appear here once they're detected."
            : "All clear! There are currently no traffic alerts to display. New alerts will appear here when they're detected."}
        </p>
      </div>
    </div>
  )
}

function ItemsSearchbar({
  placeholder: placeholder = "Search",
  value,
  onSearchChange,
}: {
  placeholder?: string
  value: string
  onSearchChange?: (searchTerm: string) => void
}) {
  const [inputValue, setInputValue] = useState(value)
  const [isPending, startTransition] = useTransition()
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSentValueRef = useRef<string>(value || "")

  // Only sync value prop to inputValue if it's an external change
  // (not from our own debounced updates). The key is to avoid syncing when:
  // 1. User is actively typing (inputValue is ahead of value)
  // 2. The value prop matches what we just sent (our own update)
  useEffect(() => {
    if (value !== undefined && value !== inputValue) {
      // Don't sync if inputValue is longer than value - user is actively typing ahead
      if (inputValue.length > value.length) {
        return
      }

      // Don't sync if this is our own debounced update
      if (value === lastSentValueRef.current) {
        return
      }

      // Only sync for clear external changes:
      // 1. External clear (value is empty but inputValue is not)
      // 2. Significant external change (value is much shorter or different)
      const isExternalClear = value === "" && inputValue !== ""
      const isSignificantlyShorter = value.length < inputValue.length - 1

      if (isExternalClear || isSignificantlyShorter) {
        setInputValue(value)
      }
    }
  }, [value, inputValue])

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      startTransition(() => {
        onSearchChange?.(inputValue)
        // Track what we sent so we can distinguish our updates from external changes
        lastSentValueRef.current = inputValue
      })
    }, 300) as ReturnType<typeof setTimeout>

    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current)
      }
    }
  }, [inputValue, onSearchChange])

  return (
    <div className="relative md:flex-1 w-full" data-pending={isPending}>
      <Input
        placeholder={placeholder}
        icon={Icons.search as any}
        value={inputValue}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const value = event.target.value
          setInputValue(value)
        }}
        className="w-full md:flex-1"
        style={{ paddingRight: "2.5rem" }}
        aria-busy={isPending}
      />
      {isPending ? (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-scale-900">
          <Icon icon={Icons.spinner} className="animate-spin" />
        </span>
      ) : null}
    </div>
  )
}

export function AlertsInbox() {
  const navigate = useNavigate()
  const location = useLocation()
  const rio = useRio()
  const { data: activeOrganization } = useCurrentOrganization()
  const activeOrgId = activeOrganization?.id
  const selectedAlertId = location.pathname.split("/").pop()
  const alertRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const filtersRowRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const [hoveredAlertId, setHoveredAlertId] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  const [showSortByLabel, setShowSortByLabel] = useState(true)
  const [showShowLabel, setShowShowLabel] = useState(true)
  const [showDescLabel, setShowDescLabel] = useState(true)
  const [showSwitch, setShowSwitch] = useState(true)
  const audioContextRef = useRef<AudioContext | null>(null)

  // Snap points state for mobile drawer (main-drawer group)
  // Initial values are just a fallback; they'll be updated based on measured header height
  const [snapState, setSnapPoint] = useAppState<{
    snapPoints: (number | string)[]
    activeSnapPoint: number | string
  }>("main-drawer.snap-points", {
    snapPoints: ["65px", 0.9],
    activeSnapPoint: "65px",
  })

  const isMobileApp = isMobileAppDevice()
  const isAtMinSnap = snapState.activeSnapPoint === snapState.snapPoints[0]

  // Individual pending states for each control
  const [isSortPending, startSortTransition] = useTransition()
  const [isCountPending, startCountTransition] = useTransition()
  const [isSortOrderPending, startSortOrderTransition] = useTransition()

  // Use alerts query context for state management (with null check)
  const alertsContext = useContext(AlertsQueryContext)

  // Return null if context is not available (e.g., rendered outside AlertsQueryProvider)
  if (!alertsContext) {
    return null
  }

  const {
    liveFilters,
    historicalFilters,
    liveSort,
    historicalSort,
    liveCount,
    historicalTimeRange,
    activeTab,
    setLiveFilters,
    setHistoricalFilters,
    setActiveTab,
    setLiveSort,
    setHistoricalSort,
    setLiveCount,
    setHistoricalTimeRange,
  } = alertsContext

  // Get the current sort, count/timeRange, and filters based on active tab
  const sort = activeTab === "live" ? liveSort : historicalSort
  const setSort = activeTab === "live" ? setLiveSort : setHistoricalSort
  const count = liveCount // Only used for live alerts
  const setCount = setLiveCount // Only used for live alerts
  const timeRange = historicalTimeRange // Only used for historical alerts
  const setTimeRange = setHistoricalTimeRange // Only used for historical alerts
  const filters = activeTab === "live" ? liveFilters : historicalFilters
  const setFilters =
    activeTab === "live" ? setLiveFilters : setHistoricalFilters

  // Get the current count/timeRange value as string for the select
  const countValue = count === null ? "all" : count.toString()
  // Ensure timeRange is always a valid option (default to "1h" if null)
  const timeRangeValue: string = timeRange ?? "1h"

  // Get sort options and limit options based on active tab
  const sortOptions =
    activeTab === "live" ? LIVE_SORT_OPTIONS : RESOLVED_SORT_OPTIONS
  const limitOptions =
    activeTab === "live" ? LIVE_COUNT_OPTIONS : HISTORICAL_TIME_RANGE_OPTIONS

  const handleSortOrderChange = (newSortOrder: "asc" | "desc") => {
    startSortOrderTransition(() => {
      setSort({
        key: sort.key,
        sortOrder: newSortOrder,
      })
    })
  }

  // Memoize search change handler to prevent unnecessary re-renders
  const handleSearchChange = useCallback(
    (searchTerm: string) => {
      setFilters({ searchTerm })
    },
    [setFilters]
  )

  // Set up real-time alerts connection
  useRealtimeAlerts()

  // Fetch alerts from API with sorting and filtering (use appropriate sort, filters, and count/timeRange for each)
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

  // Fetch RAW alerts (without any filters) for change detection
  // Use wider time range (2 days) for change detection to catch all recent resolutions
  const { alerts: rawLiveAlerts } = useAlertsQuery({}, liveSort, null)
  const { alerts: rawHistoricalAlertsForDetection } = useHistoricalAlertsQuery(
    {},
    historicalSort,
    "2d"
  )

  // Fetch historical alerts with current time range (no search filters) for count display
  const { alerts: rawHistoricalAlertsForCount } = useHistoricalAlertsQuery(
    {},
    historicalSort,
    historicalTimeRange
  )

  // Track previous RAW alert IDs to detect actual data changes (not filter/sort changes)
  const prevRawLiveAlertIdsRef = useRef<Set<string>>(new Set())
  const prevRawHistoricalAlertIdsRef = useRef<Set<string>>(new Set())
  const isInitialMountRef = useRef(true)

  // Measure header height (tabs + search + filters) and update snap points
  useLayoutEffect(() => {
    if (!headerRef.current) return

    const headerHeight =
      headerRef.current.offsetHeight + DRAWER_HANDLE_HEIGHT + EXTRA_SNAP_HEIGHT
    setSnapPoint({
      snapPoints: [`${headerHeight}px`, 0.9],
      activeSnapPoint: `${headerHeight}px`,
    })
  }, [setSnapPoint])

  // Lightweight ping sound for new congestion alerts using Web Audio API
  const playCongestionPing = useCallback(() => {
    if (typeof window === "undefined") {
      return
    }

    const AudioCtx =
      (window as any).AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) {
      return
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioCtx()
    }

    const ctx = audioContextRef.current

    // Some browsers start the context suspended until a user gesture
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {
        // Ignore resume failures – just skip the sound
      })
    }

    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()

    oscillator.type = "sine"
    oscillator.frequency.setValueAtTime(880, ctx.currentTime)

    // Quick attack/decay envelope for a short, soft ping
    gain.gain.setValueAtTime(0.001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25)

    oscillator.connect(gain)
    gain.connect(ctx.destination)

    oscillator.start()
    oscillator.stop(ctx.currentTime + 0.3)
  }, [])

  // Calculate counts for tabs
  const liveAlertsCount = rawLiveAlerts.length
  // For resolved alerts, show count based on time range (filtered alerts, no search)
  const resolvedAlertsCountRaw = rawHistoricalAlertsForCount.filter(
    (alert) => alert.type === "resolved" || alert.type === "suppressed"
  ).length
  // Format count: show "1000+" if >= 1000
  const resolvedAlertsCount =
    resolvedAlertsCountRaw >= 1000 ? "1000+" : resolvedAlertsCountRaw.toString()

  // Detect actual data changes and show toast (independent of filter/sort changes)
  useEffect(() => {
    // Skip on initial mount
    if (isInitialMountRef.current) {
      prevRawLiveAlertIdsRef.current = new Set<string>(
        rawLiveAlerts.map((a) => a.id)
      )
      prevRawHistoricalAlertIdsRef.current = new Set<string>(
        rawHistoricalAlertsForDetection.map((a) => a.id)
      )
      isInitialMountRef.current = false
      return
    }

    const currentRawLiveAlertIds = new Set<string>(
      rawLiveAlerts.map((a) => a.id)
    )
    const currentRawHistoricalAlertIds = new Set<string>(
      rawHistoricalAlertsForDetection.map((a) => a.id)
    )

    // Calculate new alerts (in current raw live but not in previous raw live)
    const newAlerts = rawLiveAlerts.filter(
      (alert) => !prevRawLiveAlertIdsRef.current.has(alert.id)
    )
    const newAlertsCount = newAlerts.length

    // Play a short ping only for newly detected congestion alerts
    const newCongestionAlerts = newAlerts.filter(
      (alert) => alert.alertType === "CONGESTION"
    )
    if (newCongestionAlerts.length > 0) {
      playCongestionPing()
      console.log(
        `🔔 Congestion ping played for ${newCongestionAlerts.length} new congestion alert(s):`,
        newCongestionAlerts.map((a) => ({ id: a.id, location: a.location }))
      )
    }

    // Count surge alerts (RAPID_DETERIORATION)
    // (kept for potential future use)
    // const newSurgeAlerts = newAlerts.filter(
    //   (alert) => alert.alertType === "RAPID_DETERIORATION"
    // )

    // Calculate resolved alerts (were in previous raw live but now in raw historical)
    const resolvedAlerts = rawHistoricalAlertsForDetection.filter(
      (alert) =>
        prevRawLiveAlertIdsRef.current.has(alert.id) &&
        !currentRawLiveAlertIds.has(alert.id) &&
        (alert.type === "resolved" || alert.type === "suppressed")
    )
    const resolvedCount = resolvedAlerts.length

    // Show toast if there are actual changes in the data
    if (newAlertsCount > 0 || resolvedCount > 0) {
      const parts: string[] = []
      if (newAlertsCount > 0) {
        parts.push(
          `${newAlertsCount} new alert${newAlertsCount === 1 ? "" : "s"} detected`
        )
      }
      if (resolvedCount > 0) {
        parts.push(
          `${resolvedCount} alert${resolvedCount === 1 ? "" : "s"} resolved`
        )
      }

      toast({
        title: parts.join(", "),
        variant: newAlertsCount > 0 ? "warning" : "success",
        duration: 4000,
      })
    }

    // Update previous refs - recreate Sets to ensure proper typing
    prevRawLiveAlertIdsRef.current = new Set<string>(
      Array.from(currentRawLiveAlertIds)
    )
    prevRawHistoricalAlertIdsRef.current = new Set<string>(
      Array.from(currentRawHistoricalAlertIds)
    )
  }, [rawLiveAlerts, rawHistoricalAlertsForDetection]) // Only depends on RAW data, not filters/sort/count

  // Get alerts based on active tab (already sorted and filtered by query hooks)
  const filteredAlerts = activeTab === "live" ? liveAlerts : historicalAlerts

  // Listen to hover events from the map
  useEffect(() => {
    const handleAlertHover = (event: {
      type: string
      alertId: string | null
      alert: Alert | null
    }) => {
      if (event.type === "alert") {
        setHoveredAlertId(event.alertId || null)
      }
    }

    rio.events.on("alert.hover", handleAlertHover)

    return () => {
      rio.events.off("alert.hover", handleAlertHover)
    }
  }, [rio])

  // Scroll alert into view when hovered from map
  useEffect(() => {
    if (hoveredAlertId) {
      const cardElement = alertRefs.current.get(hoveredAlertId)
      if (cardElement && scrollContainerRef.current) {
        cardElement.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        })
      }
    }
  }, [hoveredAlertId])

  // Selection persistence: Auto-switch tab and scroll to selected alert
  // Track previous alert ID and location separately to detect new selections vs tab moves
  const prevSelectedAlertId = useRef<string | null>(null)
  const prevSelectedAlertLocation = useRef<"live" | "resolved" | null>(null)
  useEffect(() => {
    if (!selectedAlertId) {
      prevSelectedAlertId.current = null
      prevSelectedAlertLocation.current = null
      return
    }

    // Check if alert is in live alerts
    const inLive = liveAlerts.some((a) => a.id === selectedAlertId)
    // Check if alert is in resolved alerts
    const inResolved = historicalAlerts.some((a) => a.id === selectedAlertId)

    // Determine current location
    const currentLocation: "live" | "resolved" | null = inLive
      ? "live"
      : inResolved
        ? "resolved"
        : null

    // Check if this is a new alert selection (different alert ID)
    const isNewSelection = prevSelectedAlertId.current !== selectedAlertId

    // Auto-switch tab if alert is in a different tab than currently active
    if (currentLocation !== null && activeTab !== currentLocation) {
      // Switch if:
      // 1. This is a new alert selection (selected from map/inbox), OR
      // 2. Same alert moved between tabs (state changed)
      const shouldSwitch =
        isNewSelection || // New selection from map/inbox
        (prevSelectedAlertLocation.current !== null &&
          prevSelectedAlertLocation.current !== currentLocation) // Alert moved between tabs

      if (shouldSwitch) {
        setActiveTab(currentLocation)
      }
    }

    // Update previous values
    prevSelectedAlertId.current = selectedAlertId
    prevSelectedAlertLocation.current = currentLocation

    // Scroll to selected alert if it's in the current tab
    if (
      (inLive && activeTab === "live") ||
      (inResolved && activeTab === "resolved")
    ) {
      // Use setTimeout to ensure DOM is updated after tab switch
      setTimeout(() => {
        const cardElement = alertRefs.current.get(selectedAlertId)
        if (cardElement && scrollContainerRef.current) {
          cardElement.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          })
        }
      }, 100)
    }
  }, [selectedAlertId, liveAlerts, historicalAlerts, activeTab, setActiveTab])

  // Detect mobile viewport
  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 640px)")
    setIsMobile(mediaQuery.matches)

    const handleChange = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches)
    }

    mediaQuery.addEventListener("change", handleChange)
    return () => {
      mediaQuery.removeEventListener("change", handleChange)
    }
  }, [])

  // Measure filters row width and hide UI progressively when too narrow (desktop only)
  // Priority: labels first, then Asc/Desc text, then entire sort order buttons (to avoid select collisions)
  // On mobile: hide all labels and show controls equally spaced
  useEffect(() => {
    const filtersRow = filtersRowRef.current
    if (!filtersRow) return

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width

        if (isMobile) {
          // On mobile: hide all labels, show all controls
          setShowDescLabel(false)
          setShowShowLabel(false)
          setShowSortByLabel(false)
          setShowSwitch(true)
        } else {
          // Progressive visibility thresholds for desktop
          // < 280px: hide sort order buttons entirely
          // 280-350px: show buttons with icons only (hide Asc/Desc text)
          // 350-420px: show buttons with Asc/Desc text, hide "Sort by:" and "Show:"
          // 420-500px: show "Sort by:", hide "Show:"
          // >= 500px: everything visible
          setShowSwitch(width >= 280)
          setShowDescLabel(width >= 350)
          setShowSortByLabel(width >= 420)
          setShowShowLabel(width >= 500)
        }
      }
    })

    resizeObserver.observe(filtersRow)

    return () => {
      resizeObserver.disconnect()
    }
  }, [isMobile])

  return (
    <div className="h-full flex flex-col bg-scale-300">
      <div className="px-3 sm:px-4 py-2.5 sm:py-3 border-b border-scale-600 bg-scale-200">
        <div className="flex flex-col w-full gap-2 sm:gap-3">
          {/* Tabs only - used for snap point min height (Active / Resolved) */}
          {isResolveAlertsEnabled ? (
            <div
              ref={headerRef}
              className={cn(isMobileApp && isAtMinSnap && "pb-5")}
            >
              <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as "live" | "resolved")}
                className="w-full"
              >
                <TabsList
                  className={cn("w-full", isMobileApp && "min-h-12 rounded-lg")}
                >
                  <TabsTrigger
                    value="live"
                    className={cn(
                      "flex-1",
                      isMobileApp &&
                        "text-base font-medium py-3 data-[state=active]:text-base"
                    )}
                  >
                    Active Alerts ({liveAlertsCount})
                  </TabsTrigger>
                  <TabsTrigger
                    value="resolved"
                    className={cn(
                      "flex-1",
                      isMobileApp &&
                        "text-base font-medium py-3 data-[state=active]:text-base"
                    )}
                  >
                    Resolved Alerts ({resolvedAlertsCount})
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          ) : (
            <div ref={headerRef} className="min-h-0" aria-hidden />
          )}

          {/* Search - full width */}
          <div className="w-full">
            <ItemsSearchbar
              value={filters.searchTerm || ""}
              onSearchChange={handleSearchChange}
            />
          </div>

          {/* Filters row - sort, sort order, and count limit */}
          <div
            ref={filtersRowRef}
            className={cn(
              "flex items-center w-full min-w-0",
              isMobile ? "gap-2" : "gap-1.5 sm:gap-2 md:gap-3"
            )}
          >
            {isMobile ? (
              <>
                {/* Mobile: Equal spacing with Asc/Desc label */}
                <div className="relative flex-1 min-w-[100px]">
                  <Select
                    value={sort.key}
                    onValueChange={(value) => {
                      startSortTransition(() => {
                        setSort({
                          key: value as any,
                          sortOrder: sort.sortOrder,
                        })
                      })
                    }}
                    disabled={isSortPending}
                  >
                    <SelectTrigger
                      className="h-9 w-full"
                      aria-busy={isSortPending}
                    >
                      <SelectValue
                        placeholder="Sort by..."
                        className="text-base"
                      >
                        {isSortPending ? (
                          <div className="flex items-center gap-2">
                            <Icon
                              icon={Icons.spinner}
                              className="animate-spin text-xl text-scale-900"
                            />
                          </div>
                        ) : (
                          sortOptions.find((opt) => opt.value === sort.key)
                            ?.label
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="z-[50000]">
                      {sortOptions.map((option) => (
                        <SelectItem
                          key={option.value}
                          value={option.value}
                          className="text-base"
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="relative flex-1 min-w-[90px]">
                  <Select
                    value={activeTab === "live" ? countValue : timeRangeValue}
                    onValueChange={(value) => {
                      startCountTransition(() => {
                        if (activeTab === "live") {
                          const newCount =
                            value === "all" ? null : parseInt(value, 10)
                          setCount(newCount)
                        } else {
                          // Convert string value to HistoricalTimeRange type
                          // Value should be one of: "20m", "1h", "6h", "1d", "2d"
                          setTimeRange(value as HistoricalTimeRange)
                        }
                      })
                    }}
                    disabled={isCountPending}
                  >
                    <SelectTrigger
                      className="h-9 w-full"
                      title={
                        activeTab === "live"
                          ? "Show top N alerts"
                          : "Time range"
                      }
                      aria-busy={isCountPending}
                    >
                      <SelectValue
                        placeholder={
                          activeTab === "live" ? "Limit..." : "Time..."
                        }
                        className="text-base"
                      >
                        {isCountPending ? (
                          <div className="flex items-center gap-2">
                            <Icon
                              icon={Icons.spinner}
                              className="animate-spin text-xl text-scale-900"
                            />
                          </div>
                        ) : (
                          limitOptions.find(
                            (opt) =>
                              opt.value ===
                              (activeTab === "live"
                                ? countValue
                                : timeRangeValue)
                          )?.label
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="z-[50000]">
                      {limitOptions.map((option) => (
                        <SelectItem
                          key={option.value}
                          value={option.value}
                          className="text-base"
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {showSwitch && (
                  <div className="flex items-center h-9 rounded-md border border-scale-600 bg-scale-100 overflow-hidden shrink-0 min-w-[70px] relative">
                    <button
                      onClick={() => handleSortOrderChange("asc")}
                      disabled={isSortOrderPending}
                      className={cn(
                        "flex items-center justify-center h-full text-sm font-medium transition-colors flex-1",
                        showDescLabel ? "gap-1.5 px-2 sm:px-2.5" : "px-2",
                        "border-r border-scale-600",
                        sort.sortOrder === "asc"
                          ? "bg-scale-1200 text-white"
                          : "bg-scale-50 text-scale-1100 hover:bg-scale-200",
                        isSortOrderPending && "opacity-50 cursor-not-allowed"
                      )}
                      title="Ascending"
                    >
                      <Icon icon="icon-[ph--arrow-up]" className="text-base" />
                      {showDescLabel && (
                        <span className="text-xs sm:text-sm">Asc</span>
                      )}
                    </button>
                    <button
                      onClick={() => handleSortOrderChange("desc")}
                      disabled={isSortOrderPending}
                      className={cn(
                        "flex items-center justify-center h-full text-sm font-medium transition-colors flex-1",
                        showDescLabel ? "gap-1.5 px-2 sm:px-2.5" : "px-2",
                        sort.sortOrder === "desc"
                          ? "bg-scale-1200 text-white"
                          : "bg-scale-50 text-scale-1100 hover:bg-scale-200",
                        isSortOrderPending && "opacity-50 cursor-not-allowed"
                      )}
                      title="Descending"
                    >
                      <Icon
                        icon="icon-[ph--arrow-down]"
                        className="text-base"
                      />
                      {showDescLabel && (
                        <span className="text-xs sm:text-sm">Desc</span>
                      )}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Desktop: Grouped with labels */}
                <div className="flex items-center gap-1 sm:gap-1.5 md:gap-2.5 min-w-0 flex-1">
                  {showSortByLabel && (
                    <span className="text-base text-scale-1100 whitespace-nowrap shrink-0">
                      Sort by:
                    </span>
                  )}
                  <div className="relative min-w-[100px] flex-1">
                    <Select
                      value={sort.key}
                      onValueChange={(value) => {
                        startSortTransition(() => {
                          setSort({
                            key: value as any,
                            sortOrder: sort.sortOrder,
                          })
                        })
                      }}
                      disabled={isSortPending}
                    >
                      <SelectTrigger
                        className="w-full min-w-[100px] max-w-[190px] h-9"
                        aria-busy={isSortPending}
                      >
                        <SelectValue
                          placeholder="Sort by..."
                          className="text-base"
                        >
                          {isSortPending ? (
                            <div className="flex items-center gap-2">
                              <Icon
                                icon={Icons.spinner}
                                className="animate-spin text-xl text-scale-900"
                              />
                            </div>
                          ) : (
                            sortOptions.find((opt) => opt.value === sort.key)
                              ?.label
                          )}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="z-[50000]">
                        {sortOptions.map((option) => (
                          <SelectItem
                            key={option.value}
                            value={option.value}
                            className="text-base"
                          >
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {/* Limit Control */}
                <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                  {showShowLabel && (
                    <span className="text-base text-scale-1100 whitespace-nowrap shrink-0">
                      Show:
                    </span>
                  )}
                  <div className="relative shrink-0">
                    <Select
                      value={activeTab === "live" ? countValue : timeRangeValue}
                      onValueChange={(value) => {
                        startCountTransition(() => {
                          if (activeTab === "live") {
                            const newCount =
                              value === "all" ? null : parseInt(value, 10)
                            setCount(newCount)
                          } else {
                            // Convert string value to HistoricalTimeRange type
                            // Value should be one of: "20m", "1h", "6h", "1d", "2d"
                            setTimeRange(value as HistoricalTimeRange)
                          }
                        })
                      }}
                      disabled={isCountPending}
                    >
                      <SelectTrigger
                        className="min-w-[70px] w-[80px] sm:w-[90px] md:w-[100px] h-9"
                        title={
                          activeTab === "live"
                            ? "Show top N alerts"
                            : "Time range"
                        }
                        aria-busy={isCountPending}
                      >
                        <SelectValue
                          placeholder={
                            activeTab === "live" ? "Limit..." : "Time..."
                          }
                          className="text-base"
                        >
                          {isCountPending ? (
                            <div className="flex items-center gap-2">
                              <Icon
                                icon={Icons.spinner}
                                className="animate-spin text-xl text-scale-900"
                              />
                            </div>
                          ) : (
                            limitOptions.find(
                              (opt) =>
                                opt.value ===
                                (activeTab === "live"
                                  ? countValue
                                  : timeRangeValue)
                            )?.label
                          )}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="z-[50000]">
                        {limitOptions.map((option) => (
                          <SelectItem
                            key={option.value}
                            value={option.value}
                            className="text-base"
                          >
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {showSwitch && (
                  <div className="flex items-center h-9 rounded-md border border-scale-600 bg-scale-100 overflow-hidden shrink-0 min-w-[70px] relative">
                    <button
                      onClick={() => handleSortOrderChange("asc")}
                      disabled={isSortOrderPending}
                      className={cn(
                        "flex items-center justify-center h-full text-sm font-medium transition-colors",
                        showDescLabel ? "gap-1.5 px-2 sm:px-2.5" : "px-2",
                        "border-r border-scale-600",
                        sort.sortOrder === "asc"
                          ? "bg-scale-1200 text-white"
                          : "bg-scale-50 text-scale-1100 hover:bg-scale-200",
                        isSortOrderPending && "opacity-50 cursor-not-allowed"
                      )}
                      title="Ascending"
                    >
                      <Icon icon="icon-[ph--arrow-up]" className="text-base" />
                      {showDescLabel && (
                        <span className="text-xs sm:text-sm">Asc</span>
                      )}
                    </button>
                    <button
                      onClick={() => handleSortOrderChange("desc")}
                      disabled={isSortOrderPending}
                      className={cn(
                        "flex items-center justify-center h-full text-sm font-medium transition-colors",
                        showDescLabel ? "gap-1.5 px-2 sm:px-2.5" : "px-2",
                        sort.sortOrder === "desc"
                          ? "bg-scale-1200 text-white"
                          : "bg-scale-50 text-scale-1100 hover:bg-scale-200",
                        isSortOrderPending && "opacity-50 cursor-not-allowed"
                      )}
                      title="Descending"
                    >
                      <Icon
                        icon="icon-[ph--arrow-down]"
                        className="text-base"
                      />
                      {showDescLabel && (
                        <span className="text-xs sm:text-sm">Desc</span>
                      )}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto pretty-scroll hide-scroll px-3 pt-2"
        data-vaul-no-drag
      >
        <Suspense key={activeOrgId} fallback={<AlertInboxSkeleton />}>
          {filteredAlerts.length === 0 ? (
            <EmptyState isResolved={activeTab === "resolved"} />
          ) : (
            filteredAlerts.map((alert) => {
              const isSelected = selectedAlertId === alert.id
              const isHovered = hoveredAlertId === alert.id

              return (
                <AlertCard
                  key={alert.id}
                  ref={(el) => {
                    if (el) {
                      alertRefs.current.set(alert.id, el)
                    } else {
                      alertRefs.current.delete(alert.id)
                    }
                  }}
                  alert={alert}
                  isSelected={isSelected}
                  isHovered={isHovered}
                  isNew={false}
                  onClick={() => {
                    navigate(`/alerts/${alert.id}`, {
                      state: { sourceTab: activeTab },
                    })
                  }}
                />
              )
            })
          )}
        </Suspense>
      </div>
    </div>
  )
}
