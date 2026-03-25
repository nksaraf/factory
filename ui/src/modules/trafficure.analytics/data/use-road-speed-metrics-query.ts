import { use } from "react"

import { AuthUIContext } from "@rio.js/auth-ui/lib/auth-ui-context"
import { useQuery } from "@rio.js/client"
import { env } from "@rio.js/env"

export interface InspectorRawMetricsDTO {
  currentSpeedKmph: number
  typicalSpeedKmph: number
  freeflowSpeedKmph: number
  delayMin: number | null
  delayPct: number | null
  speedChange7dKmph: number | null
  speedChange30dKmph: number | null
  freeflowPct: number | null
  speedRatio: number | null
  deviationIndex: number | null
}

/**
 * API response structure from the backend
 */
interface ApiSpeedStatusResponse {
  meta: {
    from: string
    to: string
    tz: string
    generated_at: string
    trace_id: string
    organization_id: string
    road_id: string
    window_days: number
  }
  data: {
    metrics: {
      raw: {
        current_speed_kmph: number
        typical_speed_kmph: number
        freeflow_speed_kmph: number
        delay_min: number
        delay_pct: number
        speed_change_7d_kmph: number
        speed_change_30d_kmph: number
        freeflow_pct: number
        speed_ratio: number
        deviation_index: number
      }
      display: {
        current_speed: string
        usual_speed: string
        delay_min: string
        delay_pct: string
        speed_change_7d: string
        speed_change_30d: string
        freeflow_pct: string
        trend_7d: string
        trend_30d: string
      }
    }
    road_segment: {
      city: string
      road_id: string
      road_name: string
      road_length_meters: number
      display_point: {
        type: string
        coordinates: number[]
      }
    }
    data_quality: {
      baseline_status: string
    }
  }
}

/**
 * Maps API response to the expected DTO format
 */
function mapApiResponseToDTO(
  apiResponse: ApiSpeedStatusResponse
): InspectorRawMetricsDTO {
  const { data: apiData } = apiResponse

  // Handle null or undefined data
  if (!apiData?.metrics?.raw) {
    return {
      currentSpeedKmph: 0,
      typicalSpeedKmph: 0,
      freeflowSpeedKmph: 0,
      delayMin: null,
      delayPct: null,
      speedChange7dKmph: null,
      speedChange30dKmph: null,
      freeflowPct: null,
      speedRatio: null,
      deviationIndex: null,
    }
  }

  const raw = apiData.metrics.raw

  return {
    currentSpeedKmph: raw.current_speed_kmph ?? 0,
    typicalSpeedKmph: raw.typical_speed_kmph ?? 0,
    freeflowSpeedKmph: raw.freeflow_speed_kmph ?? 0,
    delayMin: raw.delay_min ?? null,
    delayPct: raw.delay_pct ?? null,
    speedChange7dKmph: raw.speed_change_7d_kmph ?? null,
    speedChange30dKmph: raw.speed_change_30d_kmph ?? null,
    freeflowPct: raw.freeflow_pct ?? null,
    speedRatio: raw.speed_ratio ?? null,
    deviationIndex: raw.deviation_index ?? null,
  }
}

/**
 * Hook to fetch road speed metrics
 * API: GET /api/v1/platform/api/v1/analytics/road_segments/{road_id}/inspector/speed_status?tz={tz}
 */
export function useRoadSpeedMetricsQuery(
  roadId: string | null,
  tz: string = "Asia/Kolkata"
) {
  const {
    hooks: { useActiveOrganization },
  } = use(AuthUIContext)
  const { data: activeOrganization } = useActiveOrganization()

  return useQuery<InspectorRawMetricsDTO>({
    queryKey:
      activeOrganization?.id && roadId
        ? ["road-speed-metrics", activeOrganization.id, roadId, tz]
        : ["road-speed-metrics", "skip"],
    // @ts-expect-error - enabled is valid but TypeScript infers suspense query type
    enabled: !!activeOrganization?.id && !!roadId,
    queryFn: async () => {
      if (!roadId || !activeOrganization?.id) {
        throw new Error("Road ID and organization ID are required")
      }

      const url = new URL(
        `${env.PUBLIC_TRAFFICURE_API_BASE_URL}/api/v1/platform/api/v1/analytics/road_segments/${roadId}/inspector/speed_status`
      )
      url.searchParams.set("tz", tz)

      const response = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch speed metrics: ${response.status}`)
      }

      const apiResponse: ApiSpeedStatusResponse = await response.json()
      return mapApiResponseToDTO(apiResponse)
    },
    staleTime: 10000, // 10 seconds
    refetchInterval: 10000, // Refetch every 10 seconds
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  })
}
