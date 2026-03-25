import { useQuery } from "@rio.js/client"
import { env } from "@rio.js/env"

export interface TrafficMetric {
  metric_id: number
  road_id: string
  /** The actual time when this traffic metric was measured (use for all temporal operations) */
  traffic_event_time: string
  calculated_speed_kmph: number
  delay_seconds: number
  delay_percent: number
  travel_time_index: number
  congestion_score: number
  traffic_status: string
  saturation_index: number
  deviation_index: number
  velocity_decay: number
  impact_cost_sec: number
  persistence_count: number
  time_bucket_15m: string
}

/**
 * Query hook for fetching traffic metrics for a specific road within a time window
 * @param roadId - The road ID to fetch metrics for
 * @param startTime - Start time for the metrics window (ISO string or Date)
 * @param endTime - End time for the metrics window (ISO string or Date), defaults to now
 * @returns Query result with traffic metrics data
 */
export function useTrafficMetrics(
  roadId: string | null,
  startTime?: Date | string | null,
  endTime?: Date | string | null
): {
  data: TrafficMetric[]
  isLoading: boolean
  error: Error | null
} {
  const startDate = startTime
    ? typeof startTime === "string"
      ? new Date(startTime)
      : startTime
    : null

  // Use startTime in query key for proper caching
  // Don't include endTime in query key since we always fetch up to "now"
  // The refetchInterval will handle updating the data
  const startTimeKey = startDate
    ? `${startDate.getTime()}`
    : "default"

  const { data, isLoading, error } = useQuery<TrafficMetric[]>({
    queryKey: roadId
      ? [
          "traffic-metrics",
          roadId,
          startTimeKey,
        ]
      : ["traffic-metrics", "skip"],
    enabled: !!roadId && !!startDate,
    queryFn: async () => {
      if (!roadId || !startDate) {
        return []
      }

      const selectFields = [
        "metric_id",
        "road_id",
        "traffic_event_time",
        "calculated_speed_kmph",
        "delay_seconds",
        "delay_percent",
        "travel_time_index",
        "congestion_score",
        "traffic_status",
        "saturation_index",
        "deviation_index",
        "velocity_decay",
        "impact_cost_sec",
        "persistence_count",
        "time_bucket_15m",
      ].join(",")

      const url = new URL(
        `${env.PUBLIC_TRAFFICURE_API_BASE_URL}/api/internal/crud/traffic_metric`,
      )
      url.searchParams.set("select", selectFields)
      url.searchParams.set("road_id", `eq.${roadId}`)
      url.searchParams.set(
        "traffic_event_time",
        `gte.${startDate.toISOString()}`,
      )
      // Note: We don't filter by endTime in the API since we always fetch up to "now"
      // The chart component will filter the data to the window as needed
      url.searchParams.set("order", "traffic_event_time.desc")

      const response = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
        },
      })

      if (!response.ok) {
        throw new Error("Failed to fetch traffic metrics")
      }

      return response.json()
    },
    refetchInterval: 60000, // Refetch every 60 seconds
  } as any)

  return {
    data: (data || []) as TrafficMetric[],
    isLoading,
    error: error as Error | null,
  }
}
