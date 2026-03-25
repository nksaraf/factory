import { matchSorter } from "match-sorter"
import { use, useMemo } from "react"

import { AuthUIContext } from "@rio.js/auth-ui/lib/auth-ui-context"
import { useQuery } from "@rio.js/client"
import { env } from "@rio.js/env"

import { ALERT_TYPE_SEVERITY_ORDER } from "../alert-type-config"
import {
  type Alert,
  type AlertApiItem,
  type AlertApiResponse,
  transformApiAlertToAlert,
} from "../alerts-data"
import {
  type AlertsFilters,
  type AlertsSort,
  type LiveAlertsSortKey,
} from "../components/alerts-query-context"
import { mapApiTimestampsToAlertTimestamps } from "../utils/alert-timestamps"

const EMPTY_ALERTS_RESULT = {
  alerts: [] as Alert[],
  apiResponse: {
    alerts: [],
    totalCount: 0,
    byType: {},
    bySeverity: {},
  } as AlertApiResponse,
}

/**
 * Query hook for fetching active alerts from the API
 * @param filters - Filters object containing searchTerm and other filter options
 * @param sort - Sort object with key and sortOrder (defaults to { key: "delay_seconds", sortOrder: "desc" })
 * @param count - Number of alerts to limit results to (null means no limit)
 * @returns Query result with alerts data transformed to Alert format, excluding dismissed alerts
 */
export function useAlertsQuery(
  filters: AlertsFilters = {},
  sort: AlertsSort = { key: "delay_seconds", sortOrder: "desc" },
  count: number | null = null
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
        "active",
        sort.key,
        sort.sortOrder,
        count,
        ...filterValues,
      ]
    : ["alerts", "active", "skip"]

  const { data, ...rest } = useQuery<{
    alerts: Alert[]
    apiResponse: AlertApiResponse
  }>({
    queryKey,
    enabled: !!activeOrganization?.id,
    queryFn: async () => {
      // Fetch alerts from API
      const response = await fetch(
        // IMPORTANT: Use the list endpoint so we always get `alert_event_time` for start time.
        `${env.PUBLIC_TRAFFICURE_API_BASE_URL}/api/v1/platform/api/alerts?organizationId=${activeOrganization.id}&currentStatus=ACTIVE&limit=200&offset=0`
      )
      if (!response.ok) {
        throw new Error("Failed to fetch alerts")
      }
      const rawApiData = await response.json()

      // Check if response is new platform API format (with data array) or old format (with alerts array)
      const isNewFormat =
        rawApiData.hasOwnProperty("data") && Array.isArray(rawApiData.data)
      const rawAlerts = isNewFormat ? rawApiData.data : rawApiData.alerts || []

      if (!rawAlerts || rawAlerts.length === 0) {
        return {
          alerts: [],
          apiResponse: {
            alerts: [],
            totalCount: 0,
            byType: {},
            bySeverity: {},
          } as AlertApiResponse,
        }
      }

      // Fetch metadata from PostgREST for all alerts, filtering out dismissed alerts
      // Extract alert IDs - handle both snake_case and camelCase
      const alertIds = rawAlerts.map((a: any) => a.alert_id ?? a.alertId)
      const url = new URL(
        `${env.PUBLIC_TRAFFICURE_API_BASE_URL}/api/internal/crud/alert`
      )
      url.searchParams.set("select", "alert_id,metadata")
      url.searchParams.set("alert_id", `in.(${alertIds.join(",")})`)
      // Filter out dismissed alerts using PostgREST JSONB filter
      // Exclude alerts where metadata->primaryFeedback->>type equals "dismiss"
      url.searchParams.set(
        "or",
        "(metadata->primaryFeedback.is.null,metadata->primaryFeedback->>type.neq.dismiss)"
      )

      const metadataResponse = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
        },
      })

      if (!metadataResponse.ok) {
        throw new Error("Failed to fetch alerts metadata")
      }

      const metadataArray = await metadataResponse.json()

      // Convert array to object keyed by alert_id
      const metadataMap: Record<number, { metadata?: any }> = {}
      for (const item of metadataArray) {
        metadataMap[item.alert_id] = { metadata: item.metadata }
      }

      // Filter out dismissed alerts - only keep alerts that are in metadata results
      const nonDismissedAlertIds = new Set(
        metadataArray.map((item: { alert_id: number }) => item.alert_id)
      )

      const filteredAlerts = rawAlerts.filter((alert: any) => {
        const alertId = alert.alert_id ?? alert.alertId
        return nonDismissedAlertIds.has(alertId)
      })

      // Transform and merge metadata
      // Map API response to AlertApiItem format, ensuring correct timestamp mapping
      const alerts: Alert[] = filteredAlerts.map((apiAlert: any) => {
        // Check if API returns snake_case (new platform API) or camelCase (old API)
        const isSnakeCase =
          apiAlert.hasOwnProperty("alert_event_time") ||
          apiAlert.hasOwnProperty("road_id")

        let alertApiItem: AlertApiItem
        if (isSnakeCase) {
          // New platform API: map snake_case to camelCase and fix timestamps
          const { startTime, lastUpdatedAt } =
            mapApiTimestampsToAlertTimestamps({
              alert_event_time: apiAlert.alert_event_time,
              alertEventTime: apiAlert.alertEventTime,
              timestamp: apiAlert.timestamp,
              current_status: apiAlert.current_status || "ACTIVE",
            })

          alertApiItem = {
            roadId: apiAlert.road_id,
            roadName: apiAlert.road_name,
            alertType: apiAlert.alert_type,
            severity: apiAlert.severity ?? "WARNING",
            reason: apiAlert.reason ?? "",
            // Canonical timestamps
            startedAt: startTime,
            lastUpdatedAt,
            // Legacy alias
            timestamp: startTime,
            currentTravelTimeSec: apiAlert.current_travel_time_sec ?? 0,
            typicalTimeSec: apiAlert.typical_time_sec ?? 0,
            persistenceCount: apiAlert.persistence_count ?? 0,
            liveSpeedKmph: apiAlert.live_speed_kmph ?? 0,
            velocityDecay: apiAlert.velocity_decay ?? 0,
            saturationIndex: apiAlert.saturation_index ?? 0,
            deviationIndex: apiAlert.deviation_index ?? 0,
            impactCostSec: apiAlert.impact_cost_sec ?? 0,
            geometry: apiAlert.geometry,
            displayPoint: apiAlert.display_point,
            alertId: apiAlert.alert_id,
            type: "active",
            resolvedAt: undefined, // Active alerts have no end time
          }
        } else {
          // Old API format (camelCase) - still need to fix timestamp mapping
          // Check if it has alert_event_time in camelCase
          if (apiAlert.alertEventTime || apiAlert.alert_event_time) {
            const { startTime, lastUpdatedAt } =
              mapApiTimestampsToAlertTimestamps({
                alert_event_time: apiAlert.alert_event_time,
                alertEventTime: apiAlert.alertEventTime,
                timestamp: apiAlert.timestamp,
                current_status: "ACTIVE",
              })
            // Override timestamp with start time
            alertApiItem = {
              ...apiAlert,
              startedAt: startTime,
              lastUpdatedAt,
              timestamp: startTime,
              type: "active",
              resolvedAt: undefined,
            }
          } else {
            // Legacy format - assume timestamp is already correct (but warn)
            console.warn(
              "Active alert missing alert_event_time/alertEventTime field, using timestamp as start time",
              apiAlert
            )
            alertApiItem = {
              ...apiAlert,
              startedAt: apiAlert.timestamp,
              lastUpdatedAt: apiAlert.timestamp,
              type: "active",
              resolvedAt: undefined,
            }
          }
        }

        const transformed = transformApiAlertToAlert(alertApiItem)
        return {
          ...transformed,
          type: "active",
          resolvedAt: undefined, // Active alerts have no end time
          startedAt: alertApiItem.startedAt ?? transformed.startedAt,
          lastUpdatedAt:
            alertApiItem.lastUpdatedAt ?? transformed.lastUpdatedAt,
          // Keep legacy alias consistent
          timestamp: alertApiItem.startedAt ?? transformed.startedAt,
          metadata: metadataMap[alertApiItem.alertId]?.metadata,
        }
      })

      // Build API response in expected format
      const apiResponse: AlertApiResponse = {
        alerts: filteredAlerts.map((a: any) => {
          // Convert to AlertApiItem format for response (if needed)
          // This is mainly for backward compatibility
          return {
            alertId: a.alert_id ?? a.alertId,
            roadId: a.road_id ?? a.roadId,
            roadName: a.road_name ?? a.roadName,
            alertType: a.alert_type ?? a.alertType,
            severity: a.severity ?? "WARNING",
            reason: a.reason ?? "",
            // Back-compat: expose start time as timestamp when possible
            timestamp: a.alert_event_time ?? a.alertEventTime ?? a.timestamp,
            startedAt: a.alert_event_time ?? a.alertEventTime ?? a.timestamp,
            lastUpdatedAt: a.timestamp,
            currentTravelTimeSec:
              a.current_travel_time_sec ?? a.currentTravelTimeSec,
            typicalTimeSec: a.typical_time_sec ?? a.typicalTimeSec ?? 0,
            persistenceCount: a.persistence_count ?? a.persistenceCount,
            liveSpeedKmph: a.live_speed_kmph ?? a.liveSpeedKmph,
            velocityDecay: a.velocity_decay ?? a.velocityDecay,
            saturationIndex: a.saturation_index ?? a.saturationIndex,
            deviationIndex: a.deviation_index ?? a.deviationIndex ?? 0,
            impactCostSec: a.impact_cost_sec ?? a.impactCostSec,
            geometry: a.geometry,
            displayPoint: a.display_point ?? a.displayPoint,
            type: "active",
          } as AlertApiItem
        }),
        totalCount:
          rawApiData.pagination?.total_count ??
          rawApiData.totalCount ??
          filteredAlerts.length,
        byType: rawApiData.by_type ?? rawApiData.byType ?? {},
        bySeverity: rawApiData.by_severity ?? rawApiData.bySeverity ?? {},
      }

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

        switch (sort.key as LiveAlertsSortKey) {
          case "delay_seconds":
            aValue = a.impactCostSec || 0
            bValue = b.impactCostSec || 0
            break
          case "deviation_index":
            aValue = a.deviationIndex || 0
            bValue = b.deviationIndex || 0
            break
          case "duration":
            // Calculate duration (current time - startedAt) for live alerts
            const now = Date.now()
            const aDuration = a.startedAt
              ? now - new Date(a.startedAt).getTime()
              : 0
            const bDuration = b.startedAt
              ? now - new Date(b.startedAt).getTime()
              : 0
            aValue = aDuration
            bValue = bDuration
            break
          case "started_at":
            aValue = new Date(a.startedAt).getTime()
            bValue = new Date(b.startedAt).getTime()
            break
          default:
            // Default to deviation index sorting
            aValue = a.deviationIndex || 0
            bValue = b.deviationIndex || 0
        }

        const comparison = bValue - aValue // Default to desc (higher first)
        return sort.sortOrder === "asc" ? -comparison : comparison
      }

      // Sort the search-filtered alerts
      const sortedAlerts = [...searchFilteredAlerts].sort(sortAlerts)

      // Apply count filter (limit to first N alerts after sorting)
      const countFilteredAlerts =
        count !== null ? sortedAlerts.slice(0, count) : sortedAlerts

      return {
        alerts: countFilteredAlerts,
        apiResponse,
      }
    },
    refetchInterval: 60000, // Refetch every 60 seconds
  } as any)

  // Handle potential undefined data with type assertion
  const result = useMemo(() => {
    return (data ?? EMPTY_ALERTS_RESULT) as {
      alerts: Alert[]
      apiResponse: AlertApiResponse
    }
  }, [data])

  return {
    ...rest,
    data: result.apiResponse,
    alerts: result.alerts,
  }
}
