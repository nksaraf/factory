import { useQuery } from "@rio.js/client"
import { env } from "@rio.js/env"
import { getCurrentISTISOString, getISTISOStringDaysAgo } from "../utils/date-utils"

export interface AlertStatisticsDataDTO {
  alertCount: number
  typeBreakdown: Record<string, number>
  avgDuration: {
    raw: {
      resolved_alerts: number
      avg_minutes: number
    }
    display: string
  }
  trend: {
    raw: {
      current_period_count: number
      previous_period_count: number
      pct_change: number
      direction: "up" | "down" | "stable"
    }
    display: string
  }
  mostAlertsOccur: string // e.g., "8-10 AM, 5-7 PM"
  longestAlertMinutes: number
}

export interface ActiveAlertDTO {
  type: string
  startedAt: string
  startedMinutesAgo: number
}

export interface AlertStatisticsResponse {
  data: AlertStatisticsDataDTO
  activeAlert: ActiveAlertDTO | null
}

/**
 * API response structure from the backend
 */
interface ApiAlertStatisticsResponse {
  meta: {
    from: string
    to: string
    tz: string
    generated_at: string
    road_id: string
  }
  data: {
    trend: {
      raw: {
        current_count: number
        previous_count: number
        pct_change: number
      }
      display: string
    }
    alert_count: number
    type_breakdown: Array<{
      type: string
      count: number
      percent: number
    }>
    avg_duration: {
      raw: {
        seconds: number
        minutes: number
      }
      display: string
    }
    active_count: number
    active_alert_ids: string[]
    longest_duration_min: number
    peak_windows: Array<{
      count: number
      hour_window: string
    }>
  }
}

/**
 * Maps API response to the expected DTO format
 */
function mapApiResponseToDTO(apiResponse: ApiAlertStatisticsResponse): AlertStatisticsResponse {
  const { data: apiData } = apiResponse

  // Handle null or undefined data
  if (!apiData) {
    return {
      data: {
        alertCount: 0,
        typeBreakdown: {},
        avgDuration: {
          raw: { resolved_alerts: 0, avg_minutes: 0 },
          display: "0 min",
        },
        trend: {
          raw: { current_period_count: 0, previous_period_count: 0, pct_change: 0, direction: "stable" },
          display: "No change",
        },
        mostAlertsOccur: null,
        longestAlertMinutes: 0,
      },
      activeAlert: null,
    }
  }

  // Map type breakdown, converting RAPID_DETERIORATION to surge
  const typeBreakdown: Record<string, number> = {}
  if (apiData.type_breakdown && Array.isArray(apiData.type_breakdown)) {
    apiData.type_breakdown.forEach((item) => {
      const key = item.type === "RAPID_DETERIORATION" ? "surge" : item.type.toLowerCase()
      typeBreakdown[key] = item.count
    })
  }

  // Derive trend direction from pct_change
  const pctChange = apiData.trend?.raw?.pct_change ?? 0
  const direction: "up" | "down" | "stable" =
    Math.abs(pctChange) < 5 ? "stable" : pctChange > 0 ? "up" : "down"

  // Format peak windows into readable time ranges
  const mostAlertsOccur = apiData.peak_windows && apiData.peak_windows.length > 0
    ? formatPeakWindows(apiData.peak_windows)
    : null

  // Handle active alert
  const activeAlert: ActiveAlertDTO | null = 
    (apiData.active_count ?? 0) > 0 && 
    apiData.active_alert_ids && 
    apiData.active_alert_ids.length > 0
      ? {
          type: "Congestion", // Default to congestion for now
          startedAt: new Date().toISOString(), // API doesn't provide exact time
          startedMinutesAgo: 0, // API doesn't provide this, would need separate endpoint
        }
      : null

  return {
    data: {
      alertCount: apiData.alert_count ?? 0,
      typeBreakdown,
      avgDuration: {
        raw: {
          resolved_alerts: apiData.alert_count ?? 0, // API doesn't provide resolved count, using total
          avg_minutes: apiData.avg_duration?.raw?.minutes ?? 0,
        },
        display: apiData.avg_duration?.display ?? "0 min",
      },
      trend: {
        raw: {
          current_period_count: apiData.trend?.raw?.current_count ?? 0,
          previous_period_count: apiData.trend?.raw?.previous_count ?? 0,
          pct_change: apiData.trend?.raw?.pct_change ?? 0,
          direction,
        },
        display: apiData.trend?.display ?? "No change",
      },
      mostAlertsOccur,
      longestAlertMinutes: apiData.longest_duration_min ?? 0,
    },
    activeAlert,
  }
}

/**
 * Formats peak windows into a readable string
 * Example: "11 AM - 12 PM, 3 PM - 4 PM"
 */
function formatPeakWindows(peakWindows: Array<{ count: number; hour_window: string }>): string {
  // Take top 2-3 peak windows
  const topWindows = peakWindows.slice(0, 2)
  
  return topWindows.map((window) => {
    // Parse the hour_window format: "2026-02-13 11:00:00 - 2026-02-13 12:00:00"
    const match = window.hour_window.match(/(\d{2}):00:00 - \d{4}-\d{2}-\d{2} (\d{2}):00:00/)
    if (match) {
      const startHour = parseInt(match[1])
      const endHour = parseInt(match[2])
      return formatTimeRange(startHour, endHour)
    }
    return window.hour_window
  }).join(", ")
}

/**
 * Formats hour range into readable format
 * Example: 11, 12 -> "11 AM - 12 PM"
 */
function formatTimeRange(startHour: number, endHour: number): string {
  const formatHour = (hour: number) => {
    if (hour === 0) return "12 AM"
    if (hour === 12) return "12 PM"
    if (hour < 12) return `${hour} AM`
    return `${hour - 12} PM`
  }
  
  return `${formatHour(startHour)} - ${formatHour(endHour)}`
}

/**
 * Hook to fetch road alert statistics
 * API: GET /api/v1/platform/api/v1/analytics/road_segments/{road_id}/inspector/alert_statistics?from={from}&to={to}&tz={tz}
 * 
 * @param roadId - The road ID
 * @param timePeriod - Number of days to look back (7, 15, or 30)
 * @param tz - Timezone (default: "Asia/Kolkata")
 */
export function useRoadAlertStatisticsQuery(
  roadId: string | null,
  timePeriod: 7 | 15 | 30 = 7,
  tz: string = "Asia/Kolkata"
) {

  return useQuery<AlertStatisticsResponse>({
    queryKey: [
      "road-alert-statistics",
      roadId,
      timePeriod,
      tz,
    ],
    queryFn: async () => {
      // Calculate from/to dates based on time period and current time in IST
      // This ensures that when the query refetches due to stale time,
      // it automatically recalculates based on the current time
      const to = getCurrentISTISOString()
      const from = getISTISOStringDaysAgo(timePeriod)

      const url = new URL(
        `${env.PUBLIC_TRAFFICURE_API_BASE_URL}/api/v1/platform/api/v1/analytics/road_segments/${roadId}/inspector/alert_statistics`
      )
      url.searchParams.set("from", from)
      url.searchParams.set("to", to)
      url.searchParams.set("tz", tz)

      const response = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch alert statistics: ${response.status}`)
      }

      const apiResponse: ApiAlertStatisticsResponse = await response.json()
      return mapApiResponseToDTO(apiResponse)
    },
    staleTime: 10000, // 10 seconds
    refetchInterval: 10000, // Refetch every 10 seconds
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  })
}

