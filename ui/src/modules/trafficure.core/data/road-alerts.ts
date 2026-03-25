import { use } from "react"

import { AuthUIContext } from "@rio.js/auth-ui/lib/auth-ui-context"
import { useQuery } from "@rio.js/client"
import { env } from "@rio.js/env"

import {
  type Alert,
  type AlertApiItem,
  transformApiAlertToAlert,
} from "../alerts-data"
import { mapApiTimestampsToAlertTimestamps } from "../utils/alert-timestamps"

/**
 * Map platform API alert (snake_case) to AlertApiItem (camelCase)
 *
 * IMPORTANT: Clear timestamp mapping
 * - Alert.timestamp = alert_event_time (ALERT START TIME)
 * - Alert.resolvedAt = timestamp (ALERT END TIME, only for resolved alerts)
 */
function mapPlatformApiAlertToAlertApiItem(apiAlert: any): AlertApiItem {
  // Map timestamps using utility function for consistency
  const { startTime, lastUpdatedAt, endTime } =
    mapApiTimestampsToAlertTimestamps({
      alert_event_time: apiAlert.alert_event_time,
      alertEventTime: apiAlert.alertEventTime,
      timestamp: apiAlert.timestamp,
      current_status: apiAlert.current_status,
    })

  // Determine alert type based on current_status
  const alertType: "active" | "resolved" | "suppressed" =
    apiAlert.current_status === "RESOLVED"
      ? "resolved"
      : apiAlert.current_status === "SUPPRESSED"
        ? "suppressed"
        : "active"

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
    type: alertType,
    // Alert end time: from timestamp (only for resolved alerts)
    resolvedAt: endTime,
  }
}

/**
 * Query hook for fetching alerts for a specific road
 * @param roadId - The road ID to fetch alerts for
 * @param limit - Maximum number of alerts to fetch (default: 3)
 * @returns Query result with alerts data transformed to Alert format
 */
export function useRoadAlertsQuery(roadId: string | null, limit: number = 3) {
  const {
    hooks: { useActiveOrganization },
  } = use(AuthUIContext)
  const { data: activeOrganization } = useActiveOrganization()

  const { data, ...rest } = useQuery<{
    alerts: Alert[]
  }>({
    queryKey:
      activeOrganization?.id && roadId
        ? [activeOrganization?.id, "alerts", "road", roadId, limit]
        : ["alerts", "road", "skip"],
    queryFn: async () => {
      if (!roadId || !activeOrganization?.id) {
        return { alerts: [] }
      }

      const url = new URL(
        `${env.PUBLIC_TRAFFICURE_API_BASE_URL}/api/v1/platform/api/alerts`
      )
      url.searchParams.set("organizationId", activeOrganization.id)
      url.searchParams.set("roadId", roadId)
      url.searchParams.set("limit", String(limit))
      url.searchParams.set("offset", "0")

      const response = await fetch(url.toString())
      if (!response.ok) {
        const bodyText = await response.text().catch(() => "")
        throw new Error(
          `Failed to fetch road alerts (${response.status}): ${bodyText}`
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
          type: apiAlertItem.type,
          resolvedAt: apiAlertItem.resolvedAt,
          startedAt: apiAlertItem.startedAt ?? transformed.startedAt,
          lastUpdatedAt:
            apiAlertItem.lastUpdatedAt ?? transformed.lastUpdatedAt,
          // Keep legacy alias consistent
          timestamp: apiAlertItem.startedAt ?? transformed.startedAt,
        }
      })

      return { alerts }
    },
    enabled: !!activeOrganization?.id && !!roadId,
    refetchInterval: 60000, // Refetch every 60 seconds
  } as any)

  const result = data || {
    alerts: [] as Alert[],
  }

  return {
    ...rest,
    alerts: result.alerts,
  }
}
