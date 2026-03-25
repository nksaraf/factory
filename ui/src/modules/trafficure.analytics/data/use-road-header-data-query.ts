import { use } from "react"

import { AuthUIContext } from "@rio.js/auth-ui/lib/auth-ui-context"
import { useQuery } from "@rio.js/client"
import { env } from "@rio.js/env"

import {
  type PlatformApiRoadSegment,
  type PlatformApiRoadSegmentsResponse,
  type Road,
  type RoadGeometry,
} from "../roads-data"

/**
 * Transform API road segment to internal Road type
 */
function mapApiRoadSegmentToRoad(apiSegment: PlatformApiRoadSegment): Road {
  const metrics = apiSegment.metrics?.raw || {}
  const traffic = apiSegment.traffic || {
    status: "",
    event_time: undefined,
    created_at: undefined,
  }
  const activeAlerts = apiSegment.active_alerts || {}

  // Transform geometry from API format to RoadGeometry format
  const geom: RoadGeometry = apiSegment.geometry
    ? {
        type: "LineString",
        crs: {
          type: "name",
          properties: {
            name: "EPSG:4326",
          },
        },
        coordinates: (apiSegment.geometry.coordinates || []) as [
          number,
          number,
        ][],
      }
    : {
        type: "LineString",
        crs: {
          type: "name",
          properties: {
            name: "EPSG:4326",
          },
        },
        coordinates: [] as [number, number][],
      }

  // Calculate delay_seconds from delay_minutes if available
  const delayMinutes = metrics.delay_minutes || 0
  const delaySeconds = delayMinutes * 60

  return {
    road_id: apiSegment.road_id || "",
    road_name: apiSegment.road_name || "",
    road_length_meters: apiSegment.road_length_meters || 0,
    tag: apiSegment.tag || "",
    organization_id: apiSegment.organization_id || "",
    geom,
    current_speed_kmph: metrics.current_speed_kmph || 0,
    current_travel_time_sec: metrics.current_travel_time_sec || 0,
    freeflow_travel_time_sec: metrics.freeflow_travel_time_sec || 0,
    delay_percent: metrics.delay_percent || 0,
    traffic_status: traffic.status || "",
    traffic_event_time: traffic.event_time || traffic.created_at || "",
    baseline_travel_time_sec: metrics.baseline_travel_time_sec || 0,
    travel_time_index: metrics.speed_ratio || 0,
    delay_seconds: delaySeconds,
    congestion_score: Math.round(
      (metrics.delay_percent || 0) * 0.8 + Math.random() * 20
    ),
    created_at: traffic.created_at || "",
    city: apiSegment.city,
    severity: apiSegment.severity,
    has_active_alert: (activeAlerts.count || 0) > 0,
    active_alerts: activeAlerts.count ? activeAlerts : undefined,
    alert_count: activeAlerts.count || 0,
  }
}

/**
 * Hook to fetch road header data (name, length, active alerts, etc.)
 * API: GET /api/v1/platform/api/v1/analytics/road_segments?organization_id={orgId}&road_id={roadId}
 *
 * @param roadId - The road ID to fetch header data for
 */
export function useRoadHeaderDataQuery(roadId: string | null) {
  const {
    hooks: { useActiveOrganization },
  } = use(AuthUIContext)
  const { data: activeOrganization } = useActiveOrganization()

  return useQuery<Road | null>({
    queryKey:
      activeOrganization?.id && roadId
        ? [activeOrganization.id, "road-header", roadId]
        : ["road-header", "skip"],
    // @ts-expect-error - enabled is valid but TypeScript infers suspense query type
    enabled: !!activeOrganization?.id && !!roadId,
    queryFn: async () => {
      if (!roadId || !activeOrganization?.id) {
        return null
      }

      const url = new URL(
        `${env.PUBLIC_TRAFFICURE_API_BASE_URL}/api/v1/platform/api/v1/analytics/road_segments`
      )
      url.searchParams.set("organization_id", activeOrganization.id)
      // Try filtering by road_id if API supports it, otherwise fetch all and filter
      url.searchParams.set("road_id", roadId)
      url.searchParams.set("limit", "5000")
      url.searchParams.set("offset", "0")
      url.searchParams.set("include_geometry", "false")
      url.searchParams.set("include_display_point", "false")

      const response = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
        },
      })

      if (!response.ok) {
        throw new Error("Failed to fetch road header data")
      }

      const apiResponse: PlatformApiRoadSegmentsResponse = await response.json()

      // Handle new API response structure: { meta: {...}, data: { road_segment: [...] } }
      const roadSegments = apiResponse?.data?.road_segment || []

      // Find the road segment matching the requested roadId
      const matchingSegment = roadSegments.find(
        (segment) => segment.road_id === roadId
      )

      if (!matchingSegment) {
        return null
      }

      // Map API road segment to internal Road object
      return mapApiRoadSegmentToRoad(matchingSegment)
    },
    staleTime: 10000, // 10 seconds
    refetchInterval: 10000, // Refetch every 10 seconds
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  })
}
