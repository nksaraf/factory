import { matchSorter } from "match-sorter"
import { useMemo } from "react"
import { use } from "react"

import { AuthUIContext } from "@rio.js/auth-ui/lib/auth-ui-context"
import { useQuery } from "@rio.js/client"
import { env } from "@rio.js/env"

import { QUESTION_CARDS } from "../components/roads-questions-overlay"
import {
  type PlatformApiRoadSegment,
  type PlatformApiRoadSegmentsResponse,
  type Road,
  type RoadApiResponse,
  type RoadGeometry,
} from "../roads-data"

/**
 * Calculate baseline speed and CV for a road based on time scope
 */
function calculateBaselineMetrics(
  road: Road,
  timeScope: TimeScope = "this_week"
): {
  baseline_speed_kmph: number
  cv_current: number
  cv_baseline: number
} {
  // Calculate baseline speed based on time scope
  // For mocking, we'll use the freeflow speed as a base and add some variation
  const freeflowSpeed = road.freeflow_travel_time_sec
    ? road.road_length_meters / 1000 / (road.freeflow_travel_time_sec / 3600)
    : 60

  // Baseline speed varies by time scope (mock implementation)
  // In real implementation, this would fetch historical data
  let baselineSpeed = freeflowSpeed
  const speedVariation = freeflowSpeed * 0.15 // 15% variation

  switch (timeScope) {
    case "this_hour":
      // Same DOW + hour baseline (4 weeks)
      baselineSpeed =
        freeflowSpeed - speedVariation * (0.3 + Math.random() * 0.4)
      break
    case "today":
      // Same DOW baseline (4 weeks)
      baselineSpeed =
        freeflowSpeed - speedVariation * (0.2 + Math.random() * 0.3)
      break
    case "this_week":
      // Same week-type baseline (4 weeks)
      baselineSpeed =
        freeflowSpeed - speedVariation * (0.1 + Math.random() * 0.2)
      break
    case "this_month":
      // Previous month baseline
      baselineSpeed =
        freeflowSpeed - speedVariation * (0.05 + Math.random() * 0.15)
      break
  }

  // Calculate Coefficient of Variation (CV) - measure of consistency
  // CV = (standard deviation / mean) * 100
  // For mocking, we'll derive CV from delay_percent and congestion_score
  const delayPercent = road.delay_percent || 0
  const congestionScore = road.congestion_score || 0

  // Current CV: higher delay/congestion = higher CV (more unpredictable)
  const cvCurrent = Math.min(
    100,
    Math.max(5, delayPercent * 0.3 + congestionScore * 0.2 + Math.random() * 10)
  )

  // Baseline CV: typically lower, varies by time scope
  const cvBaseline = Math.min(
    100,
    Math.max(5, cvCurrent - (5 + Math.random() * 15))
  )

  return {
    baseline_speed_kmph: Math.round(baselineSpeed * 10) / 10,
    cv_current: Math.round(cvCurrent * 10) / 10,
    cv_baseline: Math.round(cvBaseline * 10) / 10,
  }
}

/**
 * Calculate degradation metrics for a road based on time scope
 */
function calculateDegradationMetrics(
  road: Road,
  timeScope: TimeScope = "this_week"
): {
  baseline_speed_kmph: number
  cv_current: number
  cv_baseline: number
  degradation_score: number
  isDegrading: boolean
} {
  const { baseline_speed_kmph, cv_current, cv_baseline } =
    calculateBaselineMetrics(road, timeScope)
  const currentSpeed = road.current_speed_kmph || 0

  // Calculate speed drop
  const speedDrop = baseline_speed_kmph - currentSpeed
  const speedDropPercent =
    baseline_speed_kmph > 0 ? (speedDrop / baseline_speed_kmph) * 100 : 0

  // Check Condition A: Speed Degradation
  // Speed has dropped by at least 3 km/h AND at least 5% of baseline
  const meetsSpeedCondition = speedDrop >= 3 && speedDropPercent >= 5

  // Check Condition B: Consistency Degradation
  // CV has increased by at least 10 percentage points
  const cvIncrease = cv_current - cv_baseline
  const meetsCVCondition = cvIncrease >= 10

  // Road is degrading if it meets EITHER condition
  const isDegrading = meetsSpeedCondition || meetsCVCondition

  // Calculate normalized values for degradation score
  // Normalize speed drop (0-100 scale, assuming max drop of 30 km/h)
  const normalizedSpeedDrop = Math.min(100, (speedDrop / 30) * 100)

  // Normalize CV increase (0-100 scale, assuming max increase of 50 points)
  const normalizedCVIncrease = Math.min(100, (cvIncrease / 50) * 100)

  // Combined degradation score
  // Speed Drop Weight = 0.7, CV Weight = 0.3
  const degradationScore =
    0.7 * normalizedSpeedDrop + 0.3 * normalizedCVIncrease

  return {
    baseline_speed_kmph,
    cv_current,
    cv_baseline,
    degradation_score: Math.round(degradationScore * 100) / 100,
    isDegrading,
  }
}

/**
 * Calculate improvement metrics for a road based on time scope
 */
function calculateImprovementMetrics(
  road: Road,
  timeScope: TimeScope = "this_week"
): {
  baseline_speed_kmph: number
  cv_current: number
  cv_baseline: number
  improvement_score: number
  isImproving: boolean
} {
  const { baseline_speed_kmph, cv_current, cv_baseline } =
    calculateBaselineMetrics(road, timeScope)
  const currentSpeed = road.current_speed_kmph || 0

  // Calculate speed gain (opposite of drop)
  const speedGain = currentSpeed - baseline_speed_kmph
  const speedGainPercent =
    baseline_speed_kmph > 0 ? (speedGain / baseline_speed_kmph) * 100 : 0

  // Check Condition A: Speed Improvement
  // Speed has increased by at least 3 km/h AND at least 5% of baseline
  const meetsSpeedCondition = speedGain >= 3 && speedGainPercent >= 5

  // Check Condition B: Consistency Improvement
  // CV has decreased by at least 10 percentage points
  const cvDecrease = cv_baseline - cv_current
  const meetsCVCondition = cvDecrease >= 10

  // Road is improving if it meets EITHER condition
  const isImproving = meetsSpeedCondition || meetsCVCondition

  // Calculate normalized values for improvement score
  // Normalize speed gain (0-100 scale, assuming max gain of 30 km/h)
  const normalizedSpeedGain = Math.min(100, Math.max(0, (speedGain / 30) * 100))

  // Normalize CV decrease (0-100 scale, assuming max decrease of 50 points)
  const normalizedCVDecrease = Math.min(
    100,
    Math.max(0, (cvDecrease / 50) * 100)
  )

  // Combined improvement score
  // Speed Gain Weight = 0.7, CV Weight = 0.3
  const improvementScore =
    0.7 * normalizedSpeedGain + 0.3 * normalizedCVDecrease

  return {
    baseline_speed_kmph,
    cv_current,
    cv_baseline,
    improvement_score: Math.round(improvementScore * 100) / 100,
    isImproving,
  }
}

/**
 * Calculate rush hour severity metrics for a road based on peak type
 * Based on 30 days of weekday data
 */
function calculateRushHourSeverity(
  road: Road,
  peakType: PeakType = "evening-peak"
): {
  rush_hour_severity_score: number
  avg_peak_delay_percent: number
  frequency_score: number
  duration_score: number
  worst_window: string
  congested_days_count: number
} {
  const delayPercent = road.delay_percent || 0

  // Mock calculation based on current delay
  // In real implementation, this would analyze 30 days of weekday data

  // Component 1: Average Peak Delay % (50% weight)
  // For mocking, derive from current delay_percent with some variation
  // Higher delay = higher peak delay
  const avgPeakDelay = Math.min(
    100,
    Math.max(0, delayPercent + (Math.random() * 20 - 10))
  )

  // Component 2: Frequency Score (30% weight)
  // Days with peak delay > 25% / Total weekdays (30) * 100
  // For mocking, roads with higher delay are more likely to congest frequently
  const baseFrequency = delayPercent > 50 ? 0.8 : delayPercent > 30 ? 0.6 : 0.3
  const frequencyPercent = Math.min(
    100,
    Math.max(0, baseFrequency * 100 + (Math.random() * 20 - 10))
  )
  const congestedDays = Math.round((frequencyPercent / 100) * 30)

  // Component 3: Duration Score (20% weight)
  // Average consecutive hours with delay > 25% during peak windows
  // Normalized to 0-100 where 3+ hours = 100
  // For mocking, roads with higher delay tend to have longer duration
  const baseDuration = delayPercent > 50 ? 2.5 : delayPercent > 30 ? 1.5 : 0.8
  const avgConsecutiveHours = Math.min(
    3,
    Math.max(0, baseDuration + (Math.random() * 0.5 - 0.25))
  )
  const durationScore = Math.min(100, (avgConsecutiveHours / 3) * 100)

  // Calculate composite score
  // Rush Hour Severity = (0.5 × Avg Peak Delay %) + (0.3 × Frequency Score) + (0.2 × Duration Score)
  const rushHourSeverity =
    0.5 * avgPeakDelay + 0.3 * frequencyPercent + 0.2 * durationScore

  // Determine worst window based on peak type
  const worstWindow =
    peakType === "morning-peak"
      ? "8-10 AM"
      : peakType === "shoulder-hours"
        ? "7-8 AM" // Default shoulder hour window (could be any of: 7-8 AM, 10-11 AM, 4-5 PM, 8-9 PM)
        : "6-8 PM" // Evening peak worst window

  return {
    rush_hour_severity_score: Math.round(rushHourSeverity * 10) / 10,
    avg_peak_delay_percent: Math.round(avgPeakDelay * 10) / 10,
    frequency_score: Math.round(frequencyPercent * 10) / 10,
    duration_score: Math.round(durationScore * 10) / 10,
    worst_window: worstWindow,
    congested_days_count: congestedDays,
  }
}

const EMPTY_ROADS_RESULT = {
  roads: [] as Road[],
  apiResponse: [] as RoadApiResponse,
}

export type TimeScope = "this_hour" | "today" | "this_week" | "this_month"
export type PeakType = "morning-peak" | "evening-peak" | "shoulder-hours"

export type RoadsFilters = {
  searchTerm?: string
  timeScope?: TimeScope // For degrading roads filter
  peakType?: PeakType // For peak hour filter
}

export type RoadsSort = {
  key: string
  sortOrder: "asc" | "desc"
}

/**
 * Map internal sort key to API sort parameter value
 */
function mapSortKeyToApiSort(
  sortKey: string,
  sortOrder: "asc" | "desc"
): string {
  switch (sortKey) {
    case "severity":
      // Severity sorts by deviation_index
      return sortOrder === "asc"
        ? "deviation_index_asc"
        : "deviation_index_desc"
    case "name":
      return sortOrder === "asc" ? "name_asc" : "name_desc"
    case "delay":
      return sortOrder === "asc" ? "delay_asc" : "delay_desc"
    case "speed":
      return sortOrder === "asc" ? "speed_asc" : "speed_desc"
    case "alerts":
      // Use deviation_index as default for alerts, will still sort client-side for alert_count
      return sortOrder === "asc"
        ? "deviation_index_asc"
        : "deviation_index_desc"
    default:
      return sortOrder === "asc"
        ? "deviation_index_asc"
        : "deviation_index_desc"
  }
}

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
    delay_minutes: delayMinutes,
    congestion_score: Math.round(
      (metrics.delay_percent || 0) * 0.8 + Math.random() * 20
    ),
    created_at: traffic.created_at || "",
    deviation_index: metrics.deviation_index,
    city: apiSegment.city,
    severity: apiSegment.severity,
    has_active_alert: (activeAlerts.count || 0) > 0,
    active_alerts: activeAlerts.count ? activeAlerts : undefined,
    alert_count: activeAlerts.count || 0,
    // Mock fields for compatibility
    speed_change_kmph: (() => {
      const delayPercent = metrics.delay_percent || 0
      const isDegrading =
        delayPercent > 50 ||
        (delayPercent > 30 && Math.random() < (delayPercent - 30) / 20)
      const change = isDegrading
        ? -(5 + Math.random() * 20)
        : 5 + Math.random() * 20
      return Math.round(change)
    })(),
    peak_hour: (() => {
      const isMorning = Math.random() < 0.5
      return isMorning
        ? Math.floor(6 + Math.random() * 4)
        : Math.floor(17 + Math.random() * 4)
    })(),
    peak_delay_percent: Math.round(
      (metrics.delay_percent || 0) + 10 + Math.random() * 35
    ),
  }
}

/**
 * Query hook for fetching roads data from the API
 * Returns sorted and filtered roads for the active organization
 * @param filters - Filters object containing searchTerm and other filter options
 * @param sort - Sort object with key and sortOrder (defaults to { key: "severity", sortOrder: "desc" })
 * @param count - Number of roads to limit results to (null means no limit)
 * @param selectedQuestion - Question ID if a question is selected (auto-handles sort and filters)
 * @returns Query result with roads data
 */
export function useRoadsQuery(
  filters: RoadsFilters = {},
  sort: RoadsSort = { key: "severity", sortOrder: "desc" },
  count: number | null = null,
  selectedQuestion: string | null = null
) {
  const {
    hooks: { useActiveOrganization },
  } = use(AuthUIContext)
  const { data: activeOrganization } = useActiveOrganization()

  // Get question card if selected
  const questionCard = selectedQuestion
    ? QUESTION_CARDS.find((q) => q.id === selectedQuestion)
    : null

  // Auto-apply question's sort if question is selected
  const effectiveSort = questionCard ? questionCard.sort : sort

  // Extract all filter values for the query key (include selectedQuestion)
  const filterValues = Object.values(filters).filter(
    (value) => value !== undefined && value !== ""
  )
  const queryKey = activeOrganization?.id
    ? [
        activeOrganization.id,
        "roads",
        "active",
        effectiveSort.key,
        effectiveSort.sortOrder,
        count,
        selectedQuestion,
        ...filterValues,
      ]
    : ["roads", "active", "skip"]

  const { data, ...rest } = useQuery<{
    roads: Road[]
    apiResponse: RoadApiResponse
  }>({
    queryKey,
    // @ts-expect-error - enabled is valid but TypeScript infers suspense query type
    enabled: !!activeOrganization?.id,
    // Keep previous data visible while fetching new data to prevent flash/white screen
    placeholderData: (previousData) => previousData,
    // Consider data fresh for 10 seconds to prevent unnecessary refetches
    staleTime: 10000,
    queryFn: async () => {
      if (!activeOrganization?.id) {
        throw new Error("Active organization ID is required")
      }

      // Fetch roads from PostgREST API, filtered by organization_id
      const url = new URL(
        `${env.PUBLIC_TRAFFICURE_API_BASE_URL}/api/internal/crud/traffic_segments_for_tiles`
      )
      url.searchParams.set("organization_id", `eq.${activeOrganization.id}`)

      if (questionCard) {
        // ===== QUESTION MODE: Fetch with question-specific params, ignore search and count =====

        // Apply server-side filters based on question if possible
        if (questionCard.id === "hotspots_now") {
          url.searchParams.set("delay_percent", "gt.50")
        }
        // Add more server-side filters for other questions as needed

        // Map question's sort key to database field name
        let dbSortKey = effectiveSort.key
        switch (effectiveSort.key) {
          case "severity":
            dbSortKey = "delay_percent"
            break
          case "delay":
            dbSortKey = "delay_seconds"
            break
          case "speed":
            dbSortKey = "current_speed_kmph"
            break
          case "alerts":
            dbSortKey = "delay_percent" // Use default for API ordering, will sort client-side
            break
          case "name":
            dbSortKey = "road_name"
            break
          default:
            dbSortKey = "delay_percent"
        }

        url.searchParams.set("order", `${dbSortKey}.${effectiveSort.sortOrder}`)

        const response = await fetch(url.toString(), {
          headers: {
            Accept: "application/json",
          },
        })

        if (!response.ok) {
          throw new Error("Failed to fetch roads")
        }

        const apiData: RoadApiResponse = await response.json()

        // Get time scope for degradation calculation
        const timeScope = filters.timeScope || "this_week"

        // Map API data to Road objects
        const roads: Road[] = (apiData || []).map((road) => {
          const baseRoad: Road = {
            road_id: road.road_id,
            road_name: road.road_name,
            road_length_meters: road.road_length_meters,
            tag: road.tag,
            organization_id: road.organization_id,
            geom: road.geom,
            current_speed_kmph: road.current_speed_kmph,
            current_travel_time_sec: road.current_travel_time_sec,
            freeflow_travel_time_sec: road.freeflow_travel_time_sec,
            delay_percent: road.delay_percent,
            traffic_status: road.traffic_status,
            traffic_event_time: road.traffic_event_time,
            baseline_travel_time_sec: road.baseline_travel_time_sec,
            travel_time_index: road.travel_time_index,
            delay_seconds: road.delay_seconds,
            delay_minutes:
              road.delay_minutes || Math.round(road.delay_seconds / 60),
            congestion_score:
              road.congestion_score ||
              Math.round((road.delay_percent || 0) * 0.8 + Math.random() * 20),
            created_at: road.created_at,
            // Calculate alert-related fields consistently
            ...(() => {
              // For most_alerts question, ensure we have some roads with alerts (60% chance)
              // Otherwise random 30% chance
              const hasAlert =
                questionCard?.id === "most_alerts"
                  ? Math.random() < 0.6
                  : Math.random() < 0.3

              return {
                has_active_alert: hasAlert,
                alert_count: hasAlert ? Math.floor(1 + Math.random() * 8) : 0,
                avg_alert_duration_minutes: hasAlert
                  ? Math.floor(15 + Math.random() * 105)
                  : undefined,
              }
            })(),
            speed_change_kmph: (() => {
              const delayPercent = road.delay_percent || 0
              const isDegrading =
                delayPercent > 50 ||
                (delayPercent > 30 && Math.random() < (delayPercent - 30) / 20)
              const change = isDegrading
                ? -(5 + Math.random() * 20)
                : 5 + Math.random() * 20
              return Math.round(change)
            })(),
            peak_hour: (() => {
              const isMorning = Math.random() < 0.5
              return isMorning
                ? Math.floor(6 + Math.random() * 4)
                : Math.floor(17 + Math.random() * 4)
            })(),
            peak_delay_percent: Math.round(
              (road.delay_percent || 0) + 10 + Math.random() * 35
            ),
          }

          // Calculate degradation metrics for degrading roads question
          if (questionCard?.id === "degrading_roads") {
            const degradationMetrics = calculateDegradationMetrics(
              baseRoad,
              timeScope
            )
            return {
              ...baseRoad,
              baseline_speed_kmph: degradationMetrics.baseline_speed_kmph,
              cv_current: degradationMetrics.cv_current,
              cv_baseline: degradationMetrics.cv_baseline,
              degradation_score: degradationMetrics.degradation_score,
            }
          }

          // Calculate improvement metrics for improving roads question
          if (questionCard?.id === "improving") {
            const improvementMetrics = calculateImprovementMetrics(
              baseRoad,
              timeScope
            )
            return {
              ...baseRoad,
              baseline_speed_kmph: improvementMetrics.baseline_speed_kmph,
              cv_current: improvementMetrics.cv_current,
              cv_baseline: improvementMetrics.cv_baseline,
              improvement_score: improvementMetrics.improvement_score,
            }
          }

          // Calculate rush hour severity metrics for peak hour question
          if (questionCard?.id === "peak_hour") {
            const peakType = filters.peakType || "evening-peak"
            const rushHourMetrics = calculateRushHourSeverity(
              baseRoad,
              peakType
            )
            return {
              ...baseRoad,
              rush_hour_severity_score:
                rushHourMetrics.rush_hour_severity_score,
              avg_peak_delay_percent: rushHourMetrics.avg_peak_delay_percent,
              frequency_score: rushHourMetrics.frequency_score,
              duration_score: rushHourMetrics.duration_score,
              worst_window: rushHourMetrics.worst_window,
              congested_days_count: rushHourMetrics.congested_days_count,
            }
          }

          return baseRoad
        })

        // For degrading/improving roads: filter to only roads meeting criteria, then sort by score
        let roadsToProcess = roads
        if (questionCard?.id === "degrading_roads") {
          // Filter to only roads that meet degradation criteria
          roadsToProcess = roads.filter((road) => {
            const degradationMetrics = calculateDegradationMetrics(
              road,
              timeScope
            )
            return degradationMetrics.isDegrading
          })
        } else if (questionCard?.id === "improving") {
          // Filter to only roads that meet improvement criteria
          roadsToProcess = roads.filter((road) => {
            const improvementMetrics = calculateImprovementMetrics(
              road,
              timeScope
            )
            return improvementMetrics.isImproving
          })
        }

        // Sort roads based on question's sort (client-side for alerts/name/degradation_score/improvement_score if needed)
        const sortedRoads = roadsToProcess.sort((a, b) => {
          let comparison = 0

          // For degrading roads, sort by degradation score
          if (questionCard?.id === "degrading_roads") {
            const aScore = a.degradation_score || 0
            const bScore = b.degradation_score || 0
            comparison = bScore - aScore // Higher score = more degrading
            return effectiveSort.sortOrder === "asc" ? -comparison : comparison
          }

          // For improving roads, sort by improvement score
          if (questionCard?.id === "improving") {
            const aScore = a.improvement_score || 0
            const bScore = b.improvement_score || 0
            comparison = bScore - aScore // Higher score = more improving
            return effectiveSort.sortOrder === "asc" ? -comparison : comparison
          }

          switch (effectiveSort.key) {
            case "severity":
              comparison = (b.delay_percent || 0) - (a.delay_percent || 0)
              break
            case "delay":
              comparison = (b.delay_seconds || 0) - (a.delay_seconds || 0)
              break
            case "speed":
              comparison =
                (b.current_speed_kmph || 0) - (a.current_speed_kmph || 0)
              break
            case "alerts":
              // Sort by alert_count (descending), then by has_active_alert
              const aCount = a.alert_count || 0
              const bCount = b.alert_count || 0
              if (aCount !== bCount) {
                comparison = bCount - aCount
              } else {
                comparison =
                  (b.has_active_alert ? 1 : 0) - (a.has_active_alert ? 1 : 0)
              }
              break
            case "name":
              const aName = (a.road_name || "").toLowerCase()
              const bName = (b.road_name || "").toLowerCase()
              if (aName < bName) comparison = -1
              else if (aName > bName) comparison = 1
              else comparison = 0
              break
            default:
              comparison = (b.delay_percent || 0) - (a.delay_percent || 0)
          }
          return effectiveSort.sortOrder === "asc" ? -comparison : comparison
        })

        // Apply question filter function if needed (for client-side only filters)
        const filteredRoads = questionCard?.filterFn
          ? sortedRoads.filter(questionCard.filterFn)
          : sortedRoads

        // For questions: return all filtered roads (no search, no count limit)
        return {
          roads: filteredRoads,
          apiResponse: apiData,
        }
      } else {
        // ===== NORMAL MODE: API Sort → Count Filter → Search =====

        // Step 1: Fetch from new platform API with sort parameter (API handles sorting directly)
        const apiUrl = new URL(
          `${env.PUBLIC_TRAFFICURE_API_BASE_URL}/api/v1/platform/api/v1/analytics/road_segments`
        )

        // Required parameter
        apiUrl.searchParams.set("organization_id", activeOrganization.id)

        // Map internal sort key to API sort value
        const apiSort = mapSortKeyToApiSort(
          effectiveSort.key,
          effectiveSort.sortOrder
        )
        apiUrl.searchParams.set("sort", apiSort)

        // Set limit to 5000 (max allowed)
        apiUrl.searchParams.set("limit", "5000")
        apiUrl.searchParams.set("offset", "0")

        // Omit geometry - MVT tiles provide geometry, API provides filtered road IDs
        // When filters active, MVT layer filters tiles client-side by road_id
        apiUrl.searchParams.set("include_geometry", "false")
        apiUrl.searchParams.set("include_display_point", "false")

        // Note: q (search query) is not sent to API - handled on frontend

        const response = await fetch(apiUrl.toString(), {
          headers: {
            Accept: "application/json",
          },
        })

        if (!response.ok) {
          throw new Error("Failed to fetch roads")
        }

        const apiResponse: PlatformApiRoadSegmentsResponse =
          await response.json()

        // Handle new API response structure: { meta: {...}, data: { road_segment: [...] } }
        const roadSegments = apiResponse?.data?.road_segment || []

        // Map API road segments to internal Road objects
        const roads: Road[] = roadSegments.map(mapApiRoadSegmentToRoad)

        // Step 2: For alerts, we need to sort client-side by alert_count since API doesn't support it
        // For all other sorts, API handles it directly
        let sortedRoads = roads
        if (effectiveSort.key === "alerts") {
          sortedRoads = [...roads].sort((a, b) => {
            const aCount = a.alert_count || 0
            const bCount = b.alert_count || 0
            if (aCount !== bCount) {
              const comparison = bCount - aCount
              return effectiveSort.sortOrder === "asc"
                ? -comparison
                : comparison
            } else {
              const comparison =
                (b.has_active_alert ? 1 : 0) - (a.has_active_alert ? 1 : 0)
              return effectiveSort.sortOrder === "asc"
                ? -comparison
                : comparison
            }
          })
        }

        // Step 3: Apply count limit (take top N roads)
        const countFilteredRoads =
          count !== null ? sortedRoads.slice(0, count) : sortedRoads

        // Step 4: Filter by search term (search within the filtered roads)
        const searchTerm = filters.searchTerm || ""
        const filteredRoads = searchTerm.trim()
          ? matchSorter(countFilteredRoads, searchTerm, {
              keys: ["road_name", "tag", "traffic_status"],
            })
          : countFilteredRoads

        // Return in the expected format (apiResponse should match old format for compatibility)
        return {
          roads: filteredRoads,
          apiResponse: filteredRoads as RoadApiResponse,
        }
      }
    },
    // Refetch every 10 seconds to get updated traffic data
    // React Query automatically deduplicates requests across components with the same query key
    // So if question card and inbox both use the same query, only one request is made
    refetchInterval: 10000,
    // Don't refetch if the window/tab is not focused (saves resources)
    refetchIntervalInBackground: false,
    // Don't refetch when window regains focus (we have refetchInterval for that)
    refetchOnWindowFocus: false,
  })

  // Handle potential undefined data with type assertion
  const result = useMemo(() => {
    return (data ?? EMPTY_ROADS_RESULT) as {
      roads: Road[]
      apiResponse: RoadApiResponse
    }
  }, [data])

  return {
    ...rest,
    data: result.apiResponse,
    roads: result.roads,
  }
}
