import { useQuery } from "@rio.js/client"
import { env } from "@rio.js/env"
import { getCurrentISTISOString, getISTISOStringDaysAgo } from "../utils/date-utils"

export interface TrendSeriesItemDTO {
  timestamp: string
  speedActualKmph: number
  speedTypicalKmph: number
  speedFreeflowKmph: number
  severityPct: number
  delayPct: number
  isPartial: boolean
}

/**
 * API response structure from the backend
 */
interface ApiTrendResponse {
  meta: {
    from: string
    to: string
    tz: string
    generated_at: string
    trace_id: string
    road_id: string
    request_range: {
      from: string
      to: string
    }
    interval_used: string
    total_points: number
  }
  series: Array<{
    timestamp: string
    speed_actual_kmph: number
    speed_typical_kmph: number
    speed_freeflow_kmph: number
    delay_pct: number
    is_partial: boolean
  }>
}

/**
 * Transform API response to DTO format
 */
function transformApiResponse(apiResponse: ApiTrendResponse): TrendSeriesItemDTO[] {
  // Handle null or undefined series
  if (!apiResponse?.series || !Array.isArray(apiResponse.series)) {
    return []
  }
  
  return apiResponse.series.map((item) => ({
    timestamp: item.timestamp,
    speedActualKmph: item.speed_actual_kmph,
    speedTypicalKmph: item.speed_typical_kmph,
    speedFreeflowKmph: item.speed_freeflow_kmph,
    severityPct: item.delay_pct, // Using delay_pct as severity
    delayPct: item.delay_pct,
    isPartial: item.is_partial,
  }))
}

/**
 * Hook to fetch road trend data
 * API: GET /api/v1/platform/api/v1/analytics/road_segments/{road_id}/inspector/trend?from={from}&to={to}
 * 
 * @param roadId - The road ID
 * @param timePeriod - Number of days to look back (1, 3, 7, 15, or 30)
 * @param interval - Time interval for data points (default: "auto") - Note: Currently not used by API
 * @param metric - Metric type to fetch (default: null) - Note: Currently not used by API
 */
export function useRoadTrendQuery(
  roadId: string | null,
  timePeriod: 1 | 3 | 7 | 15 | 30 = 7,
  interval: string = "auto",
  metric: string | null = null
) {
  return useQuery<TrendSeriesItemDTO[]>({
    queryKey: ["road-trend", roadId, timePeriod, interval, metric],
    queryFn: async () => {
      if (!roadId) {
        return []
      }

      // Calculate from/to dates based on time period and current time in IST
      // This ensures that when the query refetches due to stale time,
      // it automatically recalculates based on the current time
      const to = getCurrentISTISOString()
      const from = getISTISOStringDaysAgo(timePeriod)

      const url = new URL(
        `${env.PUBLIC_TRAFFICURE_API_BASE_URL}/api/v1/platform/api/v1/analytics/road_segments/${roadId}/inspector/trend`
      )
      url.searchParams.set("from", from)
      url.searchParams.set("to", to)

      const response = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch trend data: ${response.status}`)
      }

      const apiResponse: ApiTrendResponse = await response.json()
      return transformApiResponse(apiResponse)
    },
    staleTime: 10000, // 10 seconds
    refetchInterval: 10000, // Refetch every 10 seconds
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  })
}

