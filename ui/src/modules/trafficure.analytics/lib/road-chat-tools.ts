import { tool } from "ai"
import { z } from "zod"
import { env } from "@rio.js/env"
import { getCurrentISTISOString, getISTISOStringDaysAgo } from "../utils/date-utils"
import { ALERT_TYPE_LABELS } from "../../trafficure.core/alert-type-config"

/**
 * Tool to fetch current speed metrics and status for a road
 */
export const getSpeedData = () => tool({
  description: `Get current speed metrics, delays, and speed changes for a road. 
  This includes current speed, typical speed, freeflow speed, delay percentages, 
  and speed changes over 7 and 30 days.`,
  inputSchema: z.object({
    roadId: z.string().describe("The road ID to fetch speed data for"),
    tz: z.string().default("Asia/Kolkata").describe("Timezone for the data"),
  }),
  execute: async ({ roadId, tz }) => {
    try {
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

      const apiResponse = await response.json()
      
      // Return simplified, readable format for the AI
      return {
        status: "success",
        data: {
          currentSpeed: `${apiResponse.data?.metrics?.display?.current_speed || "N/A"}`,
          typicalSpeed: `${apiResponse.data?.metrics?.display?.usual_speed || "N/A"}`,
          delay: `${apiResponse.data?.metrics?.display?.delay_min || "0 min"} (${apiResponse.data?.metrics?.display?.delay_pct || "0%"})`,
          speedChange7d: apiResponse.data?.metrics?.display?.speed_change_7d || "N/A",
          speedChange30d: apiResponse.data?.metrics?.display?.speed_change_30d || "N/A",
          trend7d: apiResponse.data?.metrics?.display?.trend_7d || "stable",
          trend30d: apiResponse.data?.metrics?.display?.trend_30d || "stable",
          freeflowPercentage: apiResponse.data?.metrics?.display?.freeflow_pct || "N/A",
          rawMetrics: {
            currentSpeedKmph: apiResponse.data?.metrics?.raw?.current_speed_kmph || 0,
            typicalSpeedKmph: apiResponse.data?.metrics?.raw?.typical_speed_kmph || 0,
            freeflowSpeedKmph: apiResponse.data?.metrics?.raw?.freeflow_speed_kmph || 0,
            delayMin: apiResponse.data?.metrics?.raw?.delay_min || 0,
            delayPct: apiResponse.data?.metrics?.raw?.delay_pct || 0,
          }
        }
      }
    } catch (error: any) {
      return {
        status: "error",
        error: error?.message || "Failed to fetch speed data",
      }
    }
  },
})

/**
 * Tool to fetch alert statistics and history for a road
 */
export const getAlertData = () => tool({
  description: `Get alert statistics for a road including total alert count, 
  type breakdown, average duration, trend over time, peak windows, and active alerts with detailed information.`,
  inputSchema: z.object({
    roadId: z.string().describe("The road ID to fetch alert data for"),
    timePeriod: z.enum(["7", "15", "30"]).default("7").describe("Number of days to look back (7, 15, or 30)"),
    tz: z.string().default("Asia/Kolkata").describe("Timezone for the data"),
  }),
  execute: async ({ roadId, timePeriod, tz }) => {
    try {
      const days = parseInt(timePeriod)
      const to = getCurrentISTISOString()
      const from = getISTISOStringDaysAgo(days)

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

      const apiResponse = await response.json()

      // Format peak windows for readability
      const peakWindows = apiResponse.data?.peak_windows?.slice(0, 3).map((w: any) => 
        `${w.hour_window} (${w.count} alerts)`
      ).join(", ") || "None"

      // Process active alerts from API response
      let activeAlertDetails = null
      const activeCount = apiResponse.data?.active_count || 0
      const activeAlerts = apiResponse.data?.active_alerts || []
      
      if (activeCount > 0 && activeAlerts.length > 0) {
        const alert = activeAlerts[0] // Get the first active alert
        const startTime = new Date(alert.event_time)
        const now = new Date()
        const durationMs = now.getTime() - startTime.getTime()
        const minutesAgo = Math.floor(durationMs / (60 * 1000))

        // Format alert type
        const alertTypeDisplay = alert.type === "RAPID_DETERIORATION" 
          ? "Surge" 
          : alert.type === "CONGESTION" 
            ? "Congestion" 
            : alert.type

        activeAlertDetails = {
          id: alert.id,
          type: alertTypeDisplay,
          rawType: alert.type,
          startedAt: startTime.toISOString(),
          minutesAgo: minutesAgo,
          duration: minutesAgo < 60 
            ? `${minutesAgo} minutes`
            : `${Math.floor(minutesAgo / 60)} hours ${minutesAgo % 60} minutes`,
        }
      }

      return {
        status: "success",
        data: {
          timePeriod: `${days} days`,
          totalAlerts: apiResponse.data?.alert_count || 0,
          activeAlertsCount: activeCount,
          activeAlert: activeAlertDetails,
          typeBreakdown: apiResponse.data?.type_breakdown || [],
          avgDuration: apiResponse.data?.avg_duration?.display || "N/A",
          longestDurationMin: apiResponse.data?.longest_duration_min || 0,
          trend: apiResponse.data?.trend?.display || "No change",
          trendRaw: {
            currentCount: apiResponse.data?.trend?.raw?.current_count || 0,
            previousCount: apiResponse.data?.trend?.raw?.previous_count || 0,
            pctChange: apiResponse.data?.trend?.raw?.pct_change || 0,
          },
          peakWindows: peakWindows,
        }
      }
    } catch (error: any) {
      return {
        status: "error",
        error: error?.message || "Failed to fetch alert data",
      }
    }
  },
})

/**
 * Tool to fetch speed trend data over time for a road
 */
export const getTrendData = () => tool({
  description: `Get speed trend data over time showing how actual speed, typical speed, 
  and delays have changed. Useful for analyzing patterns and trends.`,
  inputSchema: z.object({
    roadId: z.string().describe("The road ID to fetch trend data for"),
    timePeriod: z.enum(["1", "3", "7", "15", "30"]).default("7").describe("Number of days to look back (1, 3, 7, 15, or 30)"),
  }),
  execute: async ({ roadId, timePeriod }) => {
    try {
      const days = parseInt(timePeriod)
      const to = getCurrentISTISOString()
      const from = getISTISOStringDaysAgo(days)

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

      const apiResponse = await response.json()
      const series = apiResponse.series || []

      // Calculate summary statistics
      const speeds = series.map((s: any) => s.speed_actual_kmph).filter((s: number) => s !== null && s > 0)
      const delays = series.map((s: any) => s.delay_pct).filter((d: number) => d !== null && typeof d === 'number')
      
      const avgSpeed = speeds.length > 0 
        ? (speeds.reduce((a: number, b: number) => a + b, 0) / speeds.length).toFixed(1)
        : "N/A"
      
      const avgDelay = delays.length > 0
        ? (delays.reduce((a: number, b: number) => a + b, 0) / delays.length).toFixed(1)
        : "0"

      const maxDelay = delays.length > 0 ? Math.max(...delays).toFixed(1) : "0"
      const minSpeed = speeds.length > 0 ? Math.min(...speeds).toFixed(1) : "N/A"

      return {
        status: "success",
        data: {
          timePeriod: `${days} days`,
          dataPoints: series.length,
          summary: {
            avgSpeed: `${avgSpeed} km/h`,
            avgDelay: `${avgDelay}%`,
            maxDelay: `${maxDelay}%`,
            minSpeed: `${minSpeed} km/h`,
          },
          recentTrend: series.slice(-10).map((s: any) => ({
            timestamp: new Date(s.timestamp).toLocaleString(),
            actualSpeed: s.speed_actual_kmph,
            typicalSpeed: s.speed_typical_kmph,
            delay: s.delay_pct,
          })),
        }
      }
    } catch (error: any) {
      return {
        status: "error",
        error: error?.message || "Failed to fetch trend data",
      }
    }
  },
})

/**
 * Tool to fetch heatmap data showing busy hours patterns
 */
export const getHeatmapData = () => tool({
  description: `Get heatmap data showing traffic patterns by day and hour. 
  This reveals when the road is typically most congested (busy hours pattern).`,
  inputSchema: z.object({
    roadId: z.string().describe("The road ID to fetch heatmap data for"),
    timePeriod: z.enum(["7", "15", "30"]).default("7").describe("Number of days to look back (7, 15, or 30)"),
  }),
  execute: async ({ roadId, timePeriod }) => {
    try {
      console.log('[getHeatmapData] Starting execution with params:', { roadId, timePeriod })
      
      const days = parseInt(timePeriod)
      const to = getCurrentISTISOString()
      const from = getISTISOStringDaysAgo(days)

      console.log('[getHeatmapData] Date range:', { from, to, days })

      const url = new URL(
        `${env.PUBLIC_TRAFFICURE_API_BASE_URL}/api/v1/platform/api/v1/analytics/road_segments/${roadId}/inspector/heatmap`
      )
      url.searchParams.set("from", from)
      url.searchParams.set("to", to)

      console.log('[getHeatmapData] Fetching from URL:', url.toString())

      const response = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
        },
      })

      console.log('[getHeatmapData] Response status:', response.status, response.statusText)

      if (!response.ok) {
        throw new Error("Failed to fetch heatmap data")
      }

      const apiResponse = await response.json()
      console.log('[getHeatmapData] API Response structure:', {
        hasData: !!apiResponse.data,
        hasHeatmap: !!apiResponse.data?.heatmap,
        hasCells: !!apiResponse.data?.heatmap?.cells,
        cellsCount: apiResponse.data?.heatmap?.cells?.length || 0,
        hasPatternRecognition: !!apiResponse.data?.pattern_recognition,
      })
      console.log('[getHeatmapData] Full API Response:', JSON.stringify(apiResponse, null, 2))

      const cells = apiResponse.data?.heatmap?.cells || []
      console.log('[getHeatmapData] Total cells received:', cells.length)

      // Log first few cells to see their structure
      if (cells.length > 0) {
        console.log('[getHeatmapData] First 3 cells sample:', JSON.stringify(cells.slice(0, 3), null, 2))
      }

      // Count cells with null values
      const nullSpeedCount = cells.filter((c: any) => c.avg_actual_speed_kmph === null).length
      const nullDelayCount = cells.filter((c: any) => c.delay_pct === null).length
      const undefinedFreeflowCount = cells.filter((c: any) => c.avg_freeflow_speed_kmph === undefined).length
      const nullFreeflowCount = cells.filter((c: any) => c.avg_freeflow_speed_kmph === null).length
      
      console.log('[getHeatmapData] Null value analysis:', {
        totalCells: cells.length,
        cellsWithNullSpeed: nullSpeedCount,
        cellsWithNullDelay: nullDelayCount,
        cellsWithUndefinedFreeflow: undefinedFreeflowCount,
        cellsWithNullFreeflow: nullFreeflowCount,
        percentageNullSpeed: cells.length > 0 ? ((nullSpeedCount / cells.length) * 100).toFixed(1) + '%' : '0%',
        percentageNullDelay: cells.length > 0 ? ((nullDelayCount / cells.length) * 100).toFixed(1) + '%' : '0%',
      })

      // Day names mapping
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

      // Find worst conditions
      const patternRecognition = apiResponse.data?.pattern_recognition || {}
      console.log('[getHeatmapData] Pattern recognition data:', patternRecognition)

      const worstDay = dayNames[patternRecognition.worst_day] || "Unknown"
      const worstHour = `${patternRecognition.worst_hour}:00 - ${patternRecognition.worst_hour + 1}:00`

      // Find top 5 most congested time slots
      const sortedCells = [...cells].sort((a: any, b: any) => {
        const delayA = a.delay_pct ?? 0
        const delayB = b.delay_pct ?? 0
        return delayB - delayA
      }).slice(0, 5)
      
      console.log('[getHeatmapData] Top 5 sorted cells (before filtering):', 
        sortedCells.map(c => ({
          day: c.day_index,
          hour: c.hour_index,
          delay: c.delay_pct,
          speed: c.avg_actual_speed_kmph
        }))
      )

      const topCongestedSlots = sortedCells
        .filter((cell: any) => cell.delay_pct !== null && cell.avg_actual_speed_kmph !== null)
        .map((cell: any) => ({
          day: dayNames[cell.day_index],
          hour: `${cell.hour_index}:00-${cell.hour_index + 1}:00`,
          delay: `${cell.delay_pct.toFixed(1)}%`,
          avgSpeed: `${cell.avg_actual_speed_kmph.toFixed(1)} km/h`,
        }))

      console.log('[getHeatmapData] Top congested slots (after filtering):', topCongestedSlots)

      // Calculate average delay by day
      const dayAverages = dayNames.map((dayName, dayIndex) => {
        const dayCells = cells.filter((c: any) => c.day_index === dayIndex && c.delay_pct !== null)
        if (dayCells.length === 0) return null
        const avgDelay = dayCells.reduce((sum: number, c: any) => sum + c.delay_pct, 0) / dayCells.length
        return {
          day: dayName,
          avgDelay: avgDelay.toFixed(1) + "%"
        }
      }).filter(d => d !== null)

      console.log('[getHeatmapData] Day averages:', dayAverages)

      // Organize complete hourly data by day
      const completeHourlyDataByDay = dayNames.map((dayName, dayIndex) => {
        const dayCells = cells.filter((c: any) => c.day_index === dayIndex)
        
        // Sort by hour
        const sortedHours = dayCells.sort((a: any, b: any) => a.hour_index - b.hour_index)
        
        const hourlyData = sortedHours.map((cell: any) => ({
          hour: `${String(cell.hour_index).padStart(2, '0')}:00`,
          actualSpeed: cell.avg_actual_speed_kmph != null ? `${cell.avg_actual_speed_kmph.toFixed(1)} km/h` : "N/A",
          typicalSpeed: cell.avg_typical_speed_kmph != null ? `${cell.avg_typical_speed_kmph.toFixed(1)} km/h` : "N/A",
          freeflowSpeed: cell.avg_freeflow_speed_kmph != null ? `${cell.avg_freeflow_speed_kmph.toFixed(1)} km/h` : "N/A",
          delay: cell.delay_pct != null ? `${cell.delay_pct.toFixed(1)}%` : "N/A",
        }))
        
        return {
          day: dayName,
          hours: hourlyData,
          dataPointsCount: hourlyData.length
        }
      }).filter(d => d.hours.length > 0)

      console.log('[getHeatmapData] Complete hourly data summary:', 
        completeHourlyDataByDay.map(d => ({ day: d.day, dataPoints: d.dataPointsCount }))
      )

      const result = {
        status: "success",
        data: {
          timePeriod: `${days} days`,
          worstConditions: {
            day: worstDay,
            hour: worstHour,
            delay: `${patternRecognition.worst_day_delay_pct?.toFixed(1) || 0}%`,
          },
          topCongestedSlots: topCongestedSlots,
          averageByDay: dayAverages,
          completeHourlyData: completeHourlyDataByDay,
          totalDataPoints: cells.length,
        }
      }

      console.log('[getHeatmapData] Final result summary:', {
        status: result.status,
        totalDataPoints: result.data.totalDataPoints,
        topCongestedSlotsCount: result.data.topCongestedSlots.length,
        averageByDayCount: result.data.averageByDay.length,
        completeHourlyDataCount: result.data.completeHourlyData.length,
      })

      return result
    } catch (error: any) {
      console.error('[getHeatmapData] Error occurred:', error)
      console.error('[getHeatmapData] Error stack:', error.stack)
      
      return {
        status: "error",
        error: error?.message || "Failed to fetch heatmap data",
      }
    }
  },
})

/**
 * Tool to fetch alert history for a road
 */
export const getAlertHistory = () => tool({
  description: `Get alert history for a specific road. Shows past alerts with their types, 
  durations, start and end times. Useful for understanding historical alert patterns on a road.`,
  inputSchema: z.object({
    roadId: z.string().describe("The road ID to fetch alert history for"),
    organizationId: z.string().describe("The organization ID"),
    limit: z.enum(["3", "5", "10", "20", "50"]).default("10").describe("Number of alerts to fetch (default: 10)"),
    alertType: z.enum(["all", "CONGESTION", "RAPID_DETERIORATION"]).default("all").describe("Filter by alert type (default: all)"),
  }),
  execute: async ({ roadId, organizationId, limit, alertType }) => {
    try {
      const limitNum = parseInt(limit)
      
      const url = new URL(
        `${env.PUBLIC_TRAFFICURE_API_BASE_URL}/api/v1/platform/api/alerts`
      )
      url.searchParams.set("organizationId", organizationId)
      url.searchParams.set("roadId", roadId)
      url.searchParams.set("limit", String(limitNum))
      url.searchParams.set("offset", "0")

      const response = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch alert history: ${response.status}`)
      }

      const apiResponse = await response.json()
      const alerts = apiResponse.data || []

      // Filter by alert type if specified
      const filteredAlerts = alertType === "all" 
        ? alerts 
        : alerts.filter((alert: any) => alert.alert_type === alertType)

      // Helper to format duration
      const formatDuration = (durationMs: number): string => {
        const durationMinutes = Math.floor(durationMs / (60 * 1000))
        
        if (durationMinutes < 1) {
          return "< 1 min"
        }
        
        if (durationMinutes < 60) {
          return `${durationMinutes} min`
        }
        
        const hours = Math.floor(durationMinutes / 60)
        const minutes = Math.floor(durationMinutes % 60)
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
      }

      // Format alert history
      const alertHistory = filteredAlerts.map((alert: any) => {
        const startTime = new Date(alert.alert_event_time || alert.timestamp)
        const isResolved = alert.current_status === "RESOLVED"
        const endTime = isResolved ? new Date(alert.timestamp) : null
        
        // Calculate duration
        let duration: string
        if (endTime) {
          const durationMs = endTime.getTime() - startTime.getTime()
          duration = formatDuration(durationMs)
        } else {
          const now = new Date()
          const durationMs = now.getTime() - startTime.getTime()
          duration = `${formatDuration(durationMs)} (ongoing)`
        }

        // Format times in IST (Asia/Kolkata)
        const formatTime = (date: Date) =>
          date.toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })

        return {
          alertType: ALERT_TYPE_LABELS[alert.alert_type as keyof typeof ALERT_TYPE_LABELS] || alert.alert_type,
          status: isResolved ? "Resolved" : "Active",
          duration: duration,
          startTime: formatTime(startTime),
          endTime: endTime ? formatTime(endTime) : "Ongoing",
          timeRange: endTime 
            ? `${formatTime(startTime)} → ${formatTime(endTime)}`
            : `${formatTime(startTime)} → Ongoing`,
        }
      })

      return {
        status: "success",
        data: {
          roadId: roadId,
          totalAlerts: alertHistory.length,
          requestedLimit: limitNum,
          alertTypeFilter: alertType === "all" ? "All Types" : ALERT_TYPE_LABELS[alertType as keyof typeof ALERT_TYPE_LABELS],
          alerts: alertHistory,
        }
      }
    } catch (error: any) {
      return {
        status: "error",
        error: error?.message || "Failed to fetch alert history",
      }
    }
  },
})


