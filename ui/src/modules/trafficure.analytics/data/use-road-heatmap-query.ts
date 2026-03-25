import { useQuery } from "@rio.js/client"
import { env } from "@rio.js/env"
import { getCurrentISTISOString, getISTISOStringDaysAgo } from "../utils/date-utils"

export interface HeatmapGridItemDTO {
  day: string
  dayIndex: number
  hour: number
  hourIndex: number
  raw: {
    delayPct: number | null
    avgActualSpeedKmph: number | null
    avgTypicalSpeedKmph: number | null
  }
  display: {
    labelDay: string
    labelTime: string
    statusLabel: string
    severityLevel: string
    colorHex: string
    delayLabel: string
    avgSpeedLabel: string
  }
}

interface HeatmapAPIResponse {
  meta: {
    from: string
    to: string
    tz: string
    generated_at: string
    trace_id: string
    road_id: string
    window_days: number
  }
  data: {
    heatmap: {
      definition: null
      metric: string
      cells: Array<{
        day_index: number
        hour_index: number
        delay_pct: number
        avg_actual_speed_kmph: number
        avg_typical_speed_kmph: number
      }>
    }
    pattern_recognition: {
      worst_day: number
      worst_day_delay_pct: number
      worst_hour: number
      worst_hour_delay_pct: number
    }
  }
}

export interface HeatmapQueryResult {
  cells: HeatmapGridItemDTO[]
  patternRecognition: {
    worstDay: number
    worstHour: number
    worstDayDelayPct: number
    worstHourDelayPct: number
  }
}

/**
 * Transform API response to HeatmapGridItemDTO format
 */
function transformHeatmapResponse(
  apiResponse: HeatmapAPIResponse
): HeatmapGridItemDTO[] {
  const daysShort = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
  
  // Handle null or undefined cells
  if (!apiResponse?.data?.heatmap?.cells) {
    return []
  }
  
  return apiResponse.data.heatmap.cells.map((cell) => {
    const dayIndex = cell.day_index
    const hour = cell.hour_index
    const delayPct = cell.delay_pct
    const avgActualSpeed = cell.avg_actual_speed_kmph
    const avgTypicalSpeed = cell.avg_typical_speed_kmph

    // Check if data is null (road closed or no data available)
    const hasNullData = delayPct === null || avgActualSpeed === null

    // Determine Severity
    let severityLevel = "NORMAL"
    let color = "#34d399" // green
    
    if (!hasNullData) {
      if (delayPct >= 50) {
        severityLevel = "TRAFFIC_JAM"
        color = "#DC2626" // red
      } else if (delayPct >= 20) {
        severityLevel = "MODERATE"
        color = "#fbbf24" // yellow
      }
    } else {
      severityLevel = "NO_DATA"
      color = "#d1d5db" // grey for no data
    }

    const labelDay =
      daysShort[dayIndex].substring(0, 1).toUpperCase() +
      daysShort[dayIndex].substring(1).toLowerCase()

    const hour12 = hour === 0 || hour === 12 ? 12 : hour % 12
    const ampm = hour < 12 ? "AM" : "PM"
    const labelTime = `${hour12}:00 ${ampm}`

    return {
      day: daysShort[dayIndex],
      dayIndex: dayIndex,
      hour: hour,
      hourIndex: hour,
      raw: {
        delayPct: delayPct,
        avgActualSpeedKmph: avgActualSpeed,
        avgTypicalSpeedKmph: avgTypicalSpeed,
      },
      display: {
        labelDay,
        labelTime,
        statusLabel: severityLevel,
        severityLevel: severityLevel,
        colorHex: color,
        delayLabel: hasNullData ? "No data available" : `${Math.round(delayPct)}% slower than usual`,
        avgSpeedLabel: hasNullData ? "Road closed" : `Average speed: ${Math.round(avgActualSpeed)} km/h`,
      },
    }
  })
}

/**
 * Hook to fetch road heatmap data
 * API: GET /api/v1/platform/api/v1/analytics/road_segments/{road_id}/inspector/heatmap
 * 
 * @param roadId - The road ID
 * @param timePeriod - Number of days to look back (7, 15, or 30)
 */
export function useRoadHeatmapQuery(
  roadId: string | undefined,
  timePeriod: 7 | 15 | 30 = 7
) {
  return useQuery<HeatmapQueryResult>({
    queryKey: ["road-heatmap", roadId, timePeriod],
    queryFn: async () => {
      if (!roadId) {
        return {
          cells: [],
          patternRecognition: {
            worstDay: 0,
            worstHour: 0,
            worstDayDelayPct: 0,
            worstHourDelayPct: 0,
          },
        }
      }

      // Calculate from/to dates based on time period and current time in IST
      // This ensures that when the query refetches due to stale time,
      // it automatically recalculates based on the current time
      const to = getCurrentISTISOString()
      const from = getISTISOStringDaysAgo(timePeriod)

      const url = new URL(
        `${env.PUBLIC_TRAFFICURE_API_BASE_URL}/api/v1/platform/api/v1/analytics/road_segments/${roadId}/inspector/heatmap`
      )
      url.searchParams.set("from", from)
      url.searchParams.set("to", to)

      const response = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
        },
      })

      if (!response.ok) {
        throw new Error("Failed to fetch heatmap data")
      }

      const apiResponse: HeatmapAPIResponse = await response.json()

      return {
        cells: transformHeatmapResponse(apiResponse),
        patternRecognition: apiResponse?.data?.pattern_recognition ? {
          worstDay: apiResponse.data.pattern_recognition.worst_day,
          worstHour: apiResponse.data.pattern_recognition.worst_hour,
          worstDayDelayPct: apiResponse.data.pattern_recognition.worst_day_delay_pct,
          worstHourDelayPct: apiResponse.data.pattern_recognition.worst_hour_delay_pct,
        } : {
          worstDay: 0,
          worstHour: 0,
          worstDayDelayPct: 0,
          worstHourDelayPct: 0,
        },
      }
    },
    staleTime: 10000, // 10 seconds
    refetchInterval: 10000, // Refetch every 10 seconds
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  })
}

