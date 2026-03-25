import { AnimatePresence, motion } from "motion/react"
import { useContext } from "react"
import { Icon } from "@rio.js/ui/icon"
import { type TrafficRoadProperties } from "./traffic-utils"
import { RoadsQueryContext } from "../trafficure.analytics/components/roads-query-context"
import { QUESTION_CARDS } from "../trafficure.analytics/components/roads-questions-overlay"
import { useRoadsQuery } from "../trafficure.analytics/data/use-roads-query"

interface RoadTooltipProps {
  properties: TrafficRoadProperties
  x: number
  y: number
  onClose?: () => void
  onViewDetails?: () => void
}

export function RoadTooltip({
  properties,
  x,
  y,
  onClose,
  onViewDetails,
}: RoadTooltipProps) {
  // Prefer API/query delay (delay_seconds or delay_minutes) so tooltip matches road inbox; fall back to computed from travel times
  const apiDelaySeconds =
    properties.delay_seconds != null && !Number.isNaN(properties.delay_seconds)
      ? properties.delay_seconds
      : properties.delay_minutes != null && !Number.isNaN(properties.delay_minutes)
        ? properties.delay_minutes * 60
        : null
  const currentTime = properties.current_travel_time_sec || 0
  const freeflowTime = properties.freeflow_travel_time_sec || 0
  const baselineTime = properties.baseline_travel_time_sec || 0
  const referenceTime = baselineTime > 0 ? baselineTime : freeflowTime
  const computedDelaySeconds = currentTime - referenceTime
  const delaySeconds = apiDelaySeconds != null ? apiDelaySeconds : computedDelaySeconds
  
  // Format delay value (absolute)
  const formatDelayValue = (seconds: number): string => {
    const absSeconds = Math.abs(seconds)
    if (absSeconds < 60) {
      return `${Math.round(absSeconds)}s`
    }
    const minutes = absSeconds / 60
    return `${Math.round(minutes)}m`
  }

  // Determine delay state (similar to road-card.tsx)
  const isBetter = delaySeconds < -5 // Negative delay (better than expected)
  const isAverage = delaySeconds >= -5 && delaySeconds <= 5 // Average delay

  // Split road name by "/" to get city and main road name
  // Format: "City/ROAD NAME"
  const roadNameParts = properties.road_name?.split("/") || []
  const city = roadNameParts.length > 1 ? roadNameParts[0].trim() : null
  const mainRoadName = roadNameParts.length > 1 ? roadNameParts[1].trim() : properties.road_name || "Unknown Road"

  // Get current speed
  const speed = Math.round(parseFloat(properties.current_speed_kmph || "0"))

  const roadsContext = useContext(RoadsQueryContext)
  const selectedQuestion = roadsContext?.selectedQuestion || null
  const questionCard = selectedQuestion
    ? QUESTION_CARDS.find((q) => q.id === selectedQuestion)
    : null

  // Fetch full road data if a question is selected to get question-specific metrics
  const filters = (() => {
    if (selectedQuestion === "degrading_roads" || selectedQuestion === "improving") {
      return { timeScope: roadsContext?.filters.timeScope || "this_week" }
    }
    if (selectedQuestion === "peak_hour") {
      return { peakType: roadsContext?.filters.peakType || "evening-peak" }
    }
    return {}
  })()
  const { roads } = useRoadsQuery(filters, { key: "severity", sortOrder: "desc" }, null, selectedQuestion)
  
  // Find the road in the filtered roads to get question-specific metrics
  const fullRoad = roads.find((r) => r.road_id === properties.road_id)

  // Render question-specific content
  const renderQuestionSpecificContent = () => {
    if (!questionCard || !fullRoad) return null

    switch (questionCard.id) {
      case "degrading_roads": {
        const degradationScore = fullRoad.degradation_score || 0
        const baselineSpeed = fullRoad.baseline_speed_kmph || 0
        const currentSpeed = fullRoad.current_speed_kmph || 0
        const speedDrop = baselineSpeed - currentSpeed
        return (
          <>
            <div className="flex items-center gap-1 mb-1">
              <Icon icon="icon-[ph--arrow-down-duotone]" className="text-base text-teal-600 font-bold" />
              <span className="text-sm text-scale-1100 flex items-center">
                <span className="inline-block w-[80px]">Speed Drop:</span>
                <span className="font-medium text-scale-1200 text-red-600">{Math.round(speedDrop * 10) / 10} km/h</span>
              </span>
            </div>
            <div className="flex items-center gap-1 mb-1">
              <Icon icon="icon-[ph--chart-line-duotone]" className="text-base text-teal-600 font-bold" />
              <span className="text-sm text-scale-1100 flex items-center">
                <span className="inline-block w-[85px]">Severity:</span>
                <span className="font-medium text-scale-1200 text-red-600">{degradationScore.toFixed(1)}%</span>
              </span>
            </div>
          </>
        )
      }
      case "improving": {
        const improvementScore = fullRoad.improvement_score || 0
        const baselineSpeed = fullRoad.baseline_speed_kmph || 0
        const currentSpeed = fullRoad.current_speed_kmph || 0
        const speedGain = currentSpeed - baselineSpeed
        return (
          <>
            <div className="flex items-center gap-1 mb-1">
              <Icon icon="icon-[ph--arrow-up-duotone]" className="text-base text-teal-600 font-bold" />
              <span className="text-sm text-scale-1100 flex items-center">
                <span className="inline-block w-[85px]">Speed Gain:</span>
                <span className="font-medium text-scale-1200 text-green-600">{Math.round(speedGain * 10) / 10} km/h</span>
              </span>
            </div>
            <div className="flex items-center gap-1 mb-1">
              <Icon icon="icon-[ph--chart-line-duotone]" className="text-base text-teal-600 font-bold" />
              <span className="text-sm text-scale-1100 flex items-center">
                <span className="inline-block w-[85px]">Improvement:</span>
                <span className="font-medium text-scale-1200 text-green-600">{improvementScore.toFixed(1)}%</span>
              </span>
            </div>
          </>
        )
      }
      case "most_alerts": {
        const alertCount = fullRoad.alert_count || 0
        const avgDuration = fullRoad.avg_alert_duration_minutes
        return (
          <>
            <div className="flex items-center gap-1 mb-1">
              <Icon icon="icon-[ph--shield-warning-duotone]" className="text-base text-teal-600 font-bold" />
              <span className="text-sm text-scale-1100 flex items-center">
                <span className="inline-block w-[90px]">Total Alerts:</span>
                <span className="font-medium text-scale-1200 text-orange-600">{alertCount}</span>
              </span>
            </div>
            {avgDuration !== undefined && avgDuration > 0 && (
              <div className="flex items-center gap-1 mb-1">
                <Icon icon="icon-[ph--timer-duotone]" className="text-base text-teal-600 font-bold" />
                <span className="text-sm text-scale-1100 flex items-center">
                  <span className="inline-block w-[90px]">Avg Duration:</span>
                  <span className="font-medium text-scale-1200 text-orange-600">{avgDuration} min</span>
                </span>
              </div>
            )}
          </>
        )
      }
      case "peak_hour": {
        const severityScore = fullRoad.rush_hour_severity_score || 0
        const worstWindow = fullRoad.worst_window || "5-8 PM"
        return (
          <>
            <div className="flex items-center gap-1 mb-1">
              <Icon icon="icon-[ph--clock-counter-clockwise-duotone]" className="text-base text-teal-600 font-bold" />
              <span className="text-sm text-scale-1100 flex items-center">
                <span className="inline-block w-[90px]">Severity:</span>
                <span className="font-medium text-scale-1200 text-orange-600">{Math.round(severityScore)}%</span>
              </span>
            </div>
            <div className="flex items-center gap-1 mb-1">
              <Icon icon="icon-[ph--clock-duotone]" className="text-base text-teal-600 font-bold" />
              <span className="text-sm text-scale-1100 flex items-center">
                <span className="inline-block w-[90px]">Worst Window:</span>
                <span className="font-medium text-scale-1200 text-orange-600">{worstWindow}</span>
              </span>
            </div>
          </>
        )
      }
      case "hotspots_now": {
        const delayPercent = Math.round(parseFloat(properties.delay_percent || "0"))
        return (
          <div className="flex items-center gap-1 mb-1">
            <Icon icon="icon-[ph--timer-duotone]" className="text-base text-teal-600 font-bold" />
            <span className="text-sm text-scale-1100 flex items-center">
              <span className="inline-block w-[90px]">Delay:</span>
              <span className="font-medium text-scale-1200 text-red-600">{delayPercent}%</span>
            </span>
          </div>
        )
      }
      default:
        return null
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 10 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="pointer-events-auto absolute z-[99999]"
        style={{
          left: x + 15,
          top: y + 15,
        }}
      >
        <div className="bg-white dark:bg-scale-900 rounded-lg shadow-lg border border-scale-300 px-2.5 pt-2 pb-1 min-w-[240px] max-w-[280px] relative">
          {/* Close Button */}
          {onClose && (
            <button
              onClick={onClose}
              className="absolute top-1.5 right-1.5 text-scale-1100 hover:text-scale-1200 transition-colors p-1"
              aria-label="Close tooltip"
            >
              <Icon icon="icon-[ph--x]" className="text-sm" />
            </button>
          )}

          {/* Road Name */}
          <div className="font-bold text-sm text-scale-1200 mb-1.5 pr-6 truncate">
            {mainRoadName}
          </div>
          
          {/* City */}


          {/* Show question-specific content if question is selected, otherwise show default */}
          {questionCard && fullRoad ? (
            renderQuestionSpecificContent()
          ) : (
            <>
              {/* Current Speed with Car Icon */}
              <div className="flex items-center gap-1 mb-1">
                <Icon icon="icon-[ph--car-duotone] " className="text-base text-teal-600 font-bold" />
                <span className="text-sm text-scale-1100 flex items-center">
                  <span className="inline-block w-[90px]">Current Speed:</span>
                  <span className="font-medium text-scale-1200">{speed} km/h</span>
                </span>
              </div>

              {/* Current Delay with Icon */}
              <div className="flex items-center gap-1 mb-1">
                <Icon icon="icon-[ph--timer-duotone] " className="text-base text-teal-600 font-bold" />
                <span className="text-sm text-scale-1100 flex items-center">
                  <span className="inline-block w-[90px]">Current Delay:</span>
                  <span className="font-medium text-scale-1200">
                    {isAverage ? "No delay" : isBetter ? `${formatDelayValue(delaySeconds)} faster` : `${formatDelayValue(delaySeconds)} slower`}
                  </span>
                </span>
              </div>
            </>
          )}

          {/* View Details Link */}
          {/* <button
            onClick={onViewDetails || (() => {})}
            className="text-sm text-teal-600 hover:text-teal-800 font-medium flex items-center gap-1 transition-colors mt-0 pl-0.5"
          >
            Click on road to view details
            <Icon icon="icon-[ph--arrow-right]" className="text-xs" />
          </button> */}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

