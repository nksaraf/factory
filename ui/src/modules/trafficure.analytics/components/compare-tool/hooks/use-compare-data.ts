import { useQuery } from "@rio.js/client"
import { ComparisonParams, ComparisonResult, HeatmapCell } from "../types"

/**
 * Mock API hook to fetch comparison data
 * In production, this would call the real API endpoint
 */
export function useCompareData(params: ComparisonParams | null) {
  return useQuery<ComparisonResult>({
    queryKey: ["compare-traffic", params],
    // @ts-expect-error - enabled is valid but TypeScript infers suspense query type
    enabled: !!params && !!params.roadName,
    queryFn: async () => {
      // Double-check params is not null (safety check)
      // This can happen if params becomes null after query is initiated
      // Instead of throwing, return a default result to prevent crashes
      if (!params || !params.roadName) {
        // Return empty/default result - the enabled check should prevent this,
        // but this is a safety net for edge cases
        const emptyHeatmap: HeatmapCell[] = []
        for (let day = 0; day < 7; day++) {
          for (let hour = 0; hour < 24; hour++) {
            emptyHeatmap.push({ day, hour, value: 0 })
          }
        }
        return {
          before: {
            avgSpeed: 0,
            avgTravelTime: 0,
            bti: 0,
            heatmapData: emptyHeatmap,
            vehicleCount: 0,
            percentile95TravelTime: 0
          },
          after: {
            avgSpeed: 0,
            avgTravelTime: 0,
            bti: 0,
            heatmapData: emptyHeatmap,
            vehicleCount: 0,
            percentile95TravelTime: 0
          },
          roadLength: 0,
          freeflowTravelTime: 0,
          roadName: ""
        }
      }
      
      // Simulate API delay
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Generate mock data
      const roadLength = 5000 // 5km in meters
      const freeflowTravelTime = 300 // 5 minutes in seconds
      const vehicleCount = 45000 // daily vehicle count

      // Generate heatmap data (7 days × 24 hours)
      const generateHeatmapData = (baseDelay: number, variation: number): HeatmapCell[] => {
        const data: HeatmapCell[] = []
        for (let day = 0; day < 7; day++) {
          for (let hour = 0; hour < 24; hour++) {
            // Higher delay during peak hours (7-9 AM, 5-7 PM) and weekdays
            const isPeakHour = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19)
            const isWeekday = day < 5
            const peakMultiplier = isPeakHour && isWeekday ? 1.5 : 1.0
            const dayVariation = (day / 7) * variation
            const hourVariation = (hour / 24) * variation * 0.5
            
            const delay = baseDelay * peakMultiplier + dayVariation + hourVariation + (Math.random() * 20 - 10)
            data.push({
              day,
              hour,
              value: Math.max(0, Math.min(100, delay))
            })
          }
        }
        return data
      }

      // Before period: higher congestion
      const beforeBaseDelay = 45
      const beforeHeatmap = generateHeatmapData(beforeBaseDelay, 15)
      const beforeAvgSpeed = 18 // km/h
      const beforeTravelTime = (roadLength / 1000) / (beforeAvgSpeed / 60) // minutes
      const beforePercentile95 = freeflowTravelTime * 2.1

      // After period: lower congestion (improvement)
      const afterBaseDelay = 30
      const afterHeatmap = generateHeatmapData(afterBaseDelay, 10)
      const afterAvgSpeed = 24 // km/h
      const afterTravelTime = (roadLength / 1000) / (afterAvgSpeed / 60) // minutes
      const afterPercentile95 = freeflowTravelTime * 1.6

      return {
        before: {
          avgSpeed: beforeAvgSpeed,
          avgTravelTime: beforeTravelTime,
          bti: beforePercentile95 / freeflowTravelTime,
          heatmapData: beforeHeatmap,
          vehicleCount,
          percentile95TravelTime: beforePercentile95
        },
        after: {
          avgSpeed: afterAvgSpeed,
          avgTravelTime: afterTravelTime,
          bti: afterPercentile95 / freeflowTravelTime,
          heatmapData: afterHeatmap,
          vehicleCount,
          percentile95TravelTime: afterPercentile95
        },
        roadLength,
        freeflowTravelTime,
        roadName: params.roadName
      }
    }
  })
}

