import { matchSorter } from "match-sorter"
import { use, useMemo } from "react"

import { AuthUIContext } from "@rio.js/auth-ui/lib/auth-ui-context"
import { useQuery } from "@rio.js/client"
import { env } from "@rio.js/env"

import {
  type Alert,
  type AlertApiItem,
  transformApiAlertToAlert,
} from "../alerts-data"
import {
  type AlertsFilters,
  type AlertsSort,
  type HistoricalAlertsSortKey,
  type HistoricalTimeRange,
} from "../components/alerts-query-context"
import { mapApiTimestampsToAlertTimestamps } from "../utils/alert-timestamps"

const EMPTY_ALERTS_RESULT = {
  alerts: [] as Alert[],
}

/**
 * Query hook for fetching historical alerts from the API
 * @param filters - Filters object containing searchTerm and other filter options
 * @param sort - Sort object with key and sortOrder (defaults to { key: "resolved_at", sortOrder: "desc" })
 * @param timeRange - Time range for filtering resolved alerts by resolvedAt (resolved/end time) (e.g., "20m", "1h", "6h", "1d", "2d", null for all)
 * @returns Query result with resolved/suppressed alerts data transformed to Alert format
 */
export function useHistoricalAlertsQuery(
  filters: AlertsFilters = {},
  sort: AlertsSort = { key: "resolved_at", sortOrder: "desc" },
  timeRange: HistoricalTimeRange = "1h"
) {
  const {
    hooks: { useActiveOrganization },
  } = use(AuthUIContext)
  const { data: activeOrganization } = useActiveOrganization()

  // Extract all filter values for the query key
  const filterValues = Object.values(filters).filter(
    (value) => value !== undefined && value !== ""
  )
  const queryKey = activeOrganization?.id
    ? [
        activeOrganization.id,
        "alerts",
        "historical",
        sort.key,
        sort.sortOrder,
        timeRange,
        ...filterValues,
      ]
    : ["alerts", "historical", "skip"]

  const { data, ...rest } = useQuery<{
    alerts: Alert[]
  }>({
    queryKey,
    queryFn: async () => {
      /**
       * Map platform API alert (snake_case) to AlertApiItem (camelCase)
       *
       * IMPORTANT: Clear timestamp mapping
       * - Alert.timestamp = alert_event_time (ALERT START TIME)
       * - Alert.resolvedAt = timestamp (ALERT END TIME for resolved alerts)
       */
      const mapPlatformApiAlertToAlertApiItem = (
        apiAlert: any
      ): AlertApiItem => {
        // Map timestamps using utility function for consistency
        const { startTime, lastUpdatedAt, endTime } =
          mapApiTimestampsToAlertTimestamps({
            alert_event_time: apiAlert.alert_event_time,
            alertEventTime: apiAlert.alertEventTime,
            timestamp: apiAlert.timestamp,
            current_status: apiAlert.current_status,
          })

        return {
          roadId: apiAlert.road_id,
          roadName: apiAlert.road_name,
          alertType: apiAlert.alert_type,
          // Older UI expects severity; platform endpoint may omit it. Default to WARNING.
          severity: apiAlert.severity ?? "WARNING",
          // Prefer `reason`; fall back to `resolution_reason` if present.
          reason: apiAlert.reason ?? apiAlert.resolution_reason ?? "",
          // Canonical timestamps
          startedAt: startTime,
          lastUpdatedAt,
          // Legacy timestamp field: keep equal to startedAt to avoid UI confusion
          timestamp: startTime,
          currentTravelTimeSec: apiAlert.current_travel_time_sec,
          typicalTimeSec: apiAlert.typical_time_sec ?? 0,
          persistenceCount: apiAlert.persistence_count,
          liveSpeedKmph: apiAlert.live_speed_kmph,
          velocityDecay: apiAlert.velocity_decay,
          saturationIndex: apiAlert.saturation_index,
          // Field may not exist on platform payload; keep a stable default.
          deviationIndex: apiAlert.deviation_index ?? 0,
          impactCostSec: apiAlert.impact_cost_sec,
          geometry: apiAlert.geometry,
          displayPoint: apiAlert.display_point,
          alertId: apiAlert.alert_id,
          type: "resolved",
          // Alert end time: from timestamp (resolution time for resolved alerts)
          resolvedAt: endTime,
        }
      }

      // Calculate time range for resolved alerts
      // Convert time range string to milliseconds
      const getTimeRangeMs = (range: HistoricalTimeRange): number | null => {
        if (!range) return null
        const match = range.match(/^(\d+)([mhd])$/)
        if (!match) return null
        const value = parseInt(match[1], 10)
        const unit = match[2]
        switch (unit) {
          case "m":
            return value * 60 * 1000 // minutes
          case "h":
            return value * 60 * 60 * 1000 // hours
          case "d":
            return value * 24 * 60 * 60 * 1000 // days
          default:
            return null
        }
      }

      const now = Date.now()
      const timeRangeMs = getTimeRangeMs(timeRange)
      // Format date in IST (Asia/Kolkata, +05:30) for API createdAfter
      const toISTISOString = (date: Date): string => {
        const parts = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Kolkata",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).formatToParts(date)
        const get = (type: string) =>
          parts.find((p) => p.type === type)?.value ?? "0"
        return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}+05:30`
      }
      // For historical alerts, filter by date using API createdAfter (resolved/end time) in IST
      const createdAfter = timeRangeMs
        ? toISTISOString(new Date(now - timeRangeMs))
        : null

      const url = new URL(
        `${env.PUBLIC_TRAFFICURE_API_BASE_URL}/api/v1/platform/api/alerts`
      )
      url.searchParams.set("organizationId", activeOrganization.id)
      url.searchParams.set("currentStatus", "RESOLVED")
      if (createdAfter) {
        url.searchParams.set("createdAfter", createdAfter)
      }
      url.searchParams.set("limit", "1000")
      url.searchParams.set("offset", "0")

      const response = await fetch(url.toString())
      if (!response.ok) {
        const bodyText = await response.text().catch(() => "")
        throw new Error(
          `Failed to fetch historical alerts (${response.status}): ${bodyText}`
        )
      }

      const apiData = (await response.json()) as {
        data?: any[]
      }

      const items = Array.isArray(apiData?.data) ? apiData.data : []
      if (items.length === 0) {
        return { alerts: [] }
      }

      const alerts: Alert[] = items.map((item) => {
        const apiAlertItem = mapPlatformApiAlertToAlertApiItem(item)
        const transformed = transformApiAlertToAlert(apiAlertItem)
        return {
          ...transformed,
          type: "resolved" as const,
          resolvedAt: apiAlertItem.resolvedAt,
          startedAt: apiAlertItem.startedAt ?? transformed.startedAt,
          lastUpdatedAt:
            apiAlertItem.lastUpdatedAt ?? transformed.lastUpdatedAt,
          // Keep legacy alias consistent
          timestamp: apiAlertItem.startedAt ?? transformed.startedAt,
        }
      })

      // Filter alerts using match-sorter if search term is provided (FIRST)
      const searchTerm = filters.searchTerm || ""
      const searchFilteredAlerts = searchTerm.trim()
        ? matchSorter(alerts, searchTerm, {
            keys: ["location", "landmark", "alertType", "severity", "roadName"],
          })
        : alerts

      // Sort function based on sort parameter
      const sortAlerts = (a: Alert, b: Alert) => {
        let aValue = 0
        let bValue = 0

        switch (sort.key as HistoricalAlertsSortKey) {
          case "resolved_at":
            // Sort by resolution time (most recent first by default)
            aValue = a.resolvedAt ? new Date(a.resolvedAt).getTime() : 0
            bValue = b.resolvedAt ? new Date(b.resolvedAt).getTime() : 0
            break
          case "duration":
            // Calculate duration (resolvedAt - startedAt)
            const aDuration =
              a.resolvedAt && a.startedAt
                ? new Date(a.resolvedAt).getTime() -
                  new Date(a.startedAt).getTime()
                : 0
            const bDuration =
              b.resolvedAt && b.startedAt
                ? new Date(b.resolvedAt).getTime() -
                  new Date(b.startedAt).getTime()
                : 0
            aValue = aDuration
            bValue = bDuration
            break
          case "started_at":
            // Sort by alert_event_time (alert start time) - startedAt is mapped from alert_event_time
            aValue = a.startedAt ? new Date(a.startedAt).getTime() : 0
            bValue = b.startedAt ? new Date(b.startedAt).getTime() : 0
            break
          default:
            // Default to resolved_at sorting
            aValue = a.resolvedAt ? new Date(a.resolvedAt).getTime() : 0
            bValue = b.resolvedAt ? new Date(b.resolvedAt).getTime() : 0
        }

        const comparison = bValue - aValue // Default to desc (higher/more recent first)
        return sort.sortOrder === "asc" ? -comparison : comparison
      }

      // Sort the search-filtered alerts
      const sortedAlerts = [...searchFilteredAlerts].sort(sortAlerts)

      // No count limit for historical alerts - time range is the filter
      return { alerts: sortedAlerts }
    },
    refetchInterval: 60000, // Refetch every 60 seconds (same as live alerts)
    enabled: !!activeOrganization?.id,
  } as any)

  // Handle potential undefined data with type assertion
  const result = useMemo(() => {
    return (data ?? EMPTY_ALERTS_RESULT) as {
      alerts: Alert[]
    }
  }, [data])

  return {
    ...rest,
    alerts: result.alerts,
  }
}
