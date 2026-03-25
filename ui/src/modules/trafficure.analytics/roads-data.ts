/**
 * Road data types matching the API response structure
 */

/**
 * Road geometry structure (GeoJSON LineString with CRS)
 */
export interface RoadGeometry {
  type: "LineString"
  crs: {
    type: "name"
    properties: {
      name: "EPSG:4326"
    }
  }
  coordinates: [number, number][] // Array of [lng, lat] pairs
}

/**
 * Individual road data structure from API
 */
export interface Road {
  road_id: string
  road_name: string
  road_length_meters: number
  tag: string
  organization_id: string
  geom: RoadGeometry
  current_speed_kmph: number
  current_travel_time_sec: number
  freeflow_travel_time_sec: number
  delay_percent: number
  traffic_status: string
  traffic_event_time: string
  baseline_travel_time_sec: number
  travel_time_index: number
  delay_seconds: number
  delay_minutes: number // Delay in minutes (from API)
  congestion_score: number
  created_at: string
  deviation_index?: number // How much slower than typical (e.g., 1.5 = 1.5x slower)
  city?: string // City name from API
  severity?: {
    level: string
    label: string
    color: string
  }
  has_active_alert?: boolean // Mock field to indicate if road has an active alert
  active_alerts?: {
    count?: number
    types?: string[]
    most_recent_start_time?: string
  }
  // Mock fields for question-specific displays
  speed_change_kmph?: number // Speed change vs last week (negative for degrading, positive for improving)
  alert_count?: number // Number of active alerts
  avg_alert_duration_minutes?: number // Average alert duration in minutes
  peak_hour?: number // Peak hour (0-23)
  peak_delay_percent?: number // Average delay percentage during peak hour
  // Degradation analysis fields
  baseline_speed_kmph?: number // Baseline speed for comparison (varies by time-scope)
  cv_current?: number // Current Coefficient of Variation (0-100)
  cv_baseline?: number // Baseline Coefficient of Variation (0-100)
  degradation_score?: number // Combined degradation score (higher = more degrading)
  improvement_score?: number // Combined improvement score (higher = more improving)
  // Rush hour bottleneck fields
  rush_hour_severity_score?: number // Rush hour severity score (0-100)
  avg_peak_delay_percent?: number // Average peak delay percentage
  frequency_score?: number // Frequency score (0-100) - how often road congests
  duration_score?: number // Duration score (0-100) - how long congestion lasts
  worst_window?: string // Worst peak window (e.g., "6-8 PM")
  congested_days_count?: number // Number of days with peak delay > 25%
}

/**
 * API response type for roads query (legacy PostgREST format)
 */
export type RoadApiResponse = Road[]

/**
 * Platform API road segment structure (from new analytics API)
 */
export interface PlatformApiRoadSegment {
  road_id: string
  road_name: string
  road_length_meters: number
  city?: string
  tag?: string
  organization_id?: string
  geometry?: {
    type: string
    coordinates: number[][]
    [key: string]: any
  }
  display_point?: {
    [key: string]: any
  }
  traffic?: {
    status: string
    event_time?: string
    created_at?: string
  }
  severity?: {
    level: string
    label: string
    color: string
  }
  metrics?: {
    raw: {
      current_speed_kmph?: number
      current_travel_time_sec?: number
      freeflow_travel_time_sec?: number
      baseline_travel_time_sec?: number
      delay_percent?: number
      delay_minutes?: number
      speed_ratio?: number
      deviation_index?: number
    }
    display?: {
      status?: string
      current_speed?: string
      travel_time?: string
      freeflow_time?: string
      baseline_time?: string
      delay_percent?: string
      delay_min?: string
      speed_ratio?: string
    }
  }
  active_alerts?: {
    count?: number
    types?: string[]
    most_recent_start_time?: string
  }
}

/**
 * Platform API response structure for road segments
 */
export interface PlatformApiRoadSegmentsResponse {
  meta: {
    sort: string
    limit: number
    offset: number
    total: number
    query?: string
    generated_at: string
    trace_id: string
    organization_id: string
  }
  data: {
    road_segment: PlatformApiRoadSegment[]
  }
}
