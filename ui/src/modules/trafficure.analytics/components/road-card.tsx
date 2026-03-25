import { forwardRef, useRef } from "react"

import { useRio } from "@rio.js/client"
import { Card, CardContent } from "@rio.js/ui/card"
import { Icon } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@rio.js/ui/tooltip"

import { type Road } from "../roads-data"
import { type QuestionCard } from "./roads-questions-overlay"

interface RoadCardProps {
  road: Road
  isSelected?: boolean
  isHovered?: boolean
  onClick?: () => void
  sortKey?: string
  question?: QuestionCard | null
  rank?: number
}

// Helper function to extract road ID from road name
// Format: "City/ROAD NAME (ID)" -> "ID"
function extractRoadId(roadName: string): string {
  const match = roadName.match(/\(([^)]+)\)/)
  return match ? match[1] : ""
}

// Helper function to get badge styling based on severity level
// Matches exact styling from alert history table
function getSeverityBadgeStyle(severityLevel: string) {
  const level = severityLevel.toUpperCase()
  
  if (level === "CRITICAL") {
    return {
      bg: "bg-red-50",
      text: "text-red-700",
      border: "border-red-200",
      icon: "icon-[ph--warning-fill]",
      iconColor: "text-red-600",
    }
  } else if (level === "HIGH") {
    return {
      bg: "bg-orange-50",
      text: "text-orange-700",
      border: "border-orange-200",
      icon: "icon-[ph--warning-duotone]",
      iconColor: "text-orange-600",
    }
  } else if (level === "MODERATE" || level === "MEDIUM") {
    return {
      bg: "bg-yellow-50",
      text: "text-yellow-700",
      border: "border-yellow-200",
      icon: "icon-[ph--info-duotone]",
      iconColor: "text-yellow-600",
    }
  } else if (level === "LOW" || level === "NORMAL") {
    return {
      bg: "bg-green-50",
      text: "text-green-700",
      border: "border-green-200",
      icon: "icon-[ph--check-circle-duotone]",
      iconColor: "text-green-600",
    }
  }
  
  // Default
  return {
    bg: "bg-gray-50",
    text: "text-gray-700",
    border: "border-gray-200",
    icon: "icon-[ph--circle-duotone]",
    iconColor: "text-gray-600",
  }
}

export const RoadCard = forwardRef<HTMLDivElement, RoadCardProps>(
  ({ road, isSelected = false, isHovered = false, onClick, question, rank }, ref) => {
    const rio = useRio()

    const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const handleMouseEnter = () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
        hoverTimeoutRef.current = null
      }
      hoverTimeoutRef.current = setTimeout(() => {
        rio.events.emit("road.hover", {
          type: "road",
          roadId: road.road_id,
          road,
        })
      }, 150)
    }

    const handleMouseLeave = () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
        hoverTimeoutRef.current = null
      }
      hoverTimeoutRef.current = setTimeout(() => {
        rio.events.emit("road.hover", {
          type: "road",
          roadId: null,
          road: null,
        })
      }, 150)
    }

    // Extract road details
    const roadNameParts = road.road_name.split("/")
    const mainRoadName = roadNameParts.length > 1 ? roadNameParts[1].trim() : road.road_name
    // Remove ID from main road name (text in parentheses)
    const mainRoadNameWithoutId = mainRoadName.replace(/\s*\([^)]+\)/, "")
    const roadId = extractRoadId(road.road_name)
    const city = road.city || (roadNameParts.length > 1 ? roadNameParts[0].trim() : "")
    
    // Calculate metrics
    const currentSpeed = Math.round(road.current_speed_kmph || 0)
    const roadLengthKm = (road.road_length_meters / 1000).toFixed(1)
    
    // Calculate congestion factor (how much slower than typical)
    const deviationIndex = road.deviation_index

    // Render question-specific right content (same as RoadDropdownItem)
    const renderQuestionRightContent = () => {
      if (!question) return null

      switch (question.id) {
        case "degrading_roads": {
          // Show degradation score and speed drop
          const degradationScore = road.degradation_score || 0
          const baselineSpeed = road.baseline_speed_kmph || 0
          const currentSpeed = road.current_speed_kmph || 0
          const speedDrop = baselineSpeed - currentSpeed
          return (
            <div className="flex flex-col items-end gap-1 shrink-0">
              <div className="flex items-center gap-1">
                <span className="text-base font-semibold font-numbers tabular-nums text-red-600">↓ {Math.round(speedDrop * 10) / 10} km/h</span>
              </div>
              <span className="text-base font-numbers tabular-nums text-scale-1000 font-medium">Score: {degradationScore.toFixed(1)}</span>
            </div>
          )
        }
        case "hotspots_now": {
          const speed = Math.round(road.current_speed_kmph || 0)
          const delayPercent = Math.round(road.delay_percent || 0)
          return (
            <div className="flex flex-col items-end gap-1 shrink-0">
              <div className="flex items-center gap-1">
                <span className="text-base font-semibold font-numbers tabular-nums text-scale-1200">{speed} km/h</span>
              </div>
              <div className="flex items-center gap-1">
                <Icon icon="icon-[ph--timer-duotone]" className="text-red-600 text-icon-sm" />
                <span className="text-base font-numbers tabular-nums text-red-600">{delayPercent}% delay</span>
              </div>
            </div>
          )
        }
        case "most_alerts": {
          // Alert count and avg duration
          const alertCount = road.alert_count || 0
          const avgDuration = road.avg_alert_duration_minutes
          return (
            <div className="flex flex-col items-end gap-1 shrink-0">
              <div className="flex items-center gap-1">
                <Icon icon="icon-[ph--shield-warning-duotone] -mt-0.5" className="text-orange-600 text-icon-sm" />
                <span className="text-base font-semibold font-numbers tabular-nums text-orange-600">{alertCount} alerts</span>
              </div>
              {avgDuration !== undefined && avgDuration > 0 && (
                <span className="text-base font-numbers tabular-nums text-scale-1000">Avg {avgDuration} min</span>
              )}
            </div>
          )
        }
        case "improving": {
          // Show improvement score and speed gain
          const improvementScore = road.improvement_score || 0
          const baselineSpeed = road.baseline_speed_kmph || 0
          const currentSpeed = road.current_speed_kmph || 0
          const speedGain = currentSpeed - baselineSpeed
          return (
            <div className="flex flex-col items-end gap-1 shrink-0">
              <div className="flex items-center gap-1">
                <span className="text-base font-semibold font-numbers tabular-nums text-green-600">↑ {Math.round(speedGain * 10) / 10} km/h</span>
              </div>
              <span className="text-base font-numbers tabular-nums text-scale-1000 font-medium">Score: {improvementScore.toFixed(1)}</span>
            </div>
          )
        }
        case "peak_hour": {
          // Show rush hour severity metrics
          const severityScore = road.rush_hour_severity_score || 0
          const worstWindow = road.worst_window || "5-8 PM"
          return (
            <div className="flex flex-col items-end gap-1 shrink-0">
              <div className="flex items-center gap-1">
                <Icon icon="icon-[ph--clock-counter-clockwise-duotone] -mt-0.5" className="text-orange-600 text-icon-sm" />
                <span className="text-base font-semibold font-numbers tabular-nums text-orange-600">{Math.round(severityScore)}%</span>
              </div>
              <span className="text-base text-scale-1000">Worst: {worstWindow}</span>
            </div>
          )
        }
        default: {
          const delayPercent = Math.round(road.delay_percent || 0)
          return (
            <div className="flex items-center gap-2 shrink-0">
              <Icon icon="icon-[ph--arrow-down]" className="text-red-600 text-icon-lg" />
              <span className="text-base font-semibold font-numbers tabular-nums text-red-600">{delayPercent}%</span>
            </div>
          )
        }
      }
    }

    // Use delay_minutes directly from API (same pattern as RoadSpeedCard)
    const delayMinutes = Math.round(road.delay_minutes || 0)
    
    // Calculate how long alert has been ongoing (in minutes)
    const getAlertOngoingTime = (startTime: string) => {
      const now = new Date()
      const alertTime = new Date(startTime)
      const diffMs = now.getTime() - alertTime.getTime()
      const diffMinutes = Math.floor(diffMs / (1000 * 60))
      
      if (diffMinutes < 60) {
        return `${diffMinutes} min`
      }
      
      const hours = Math.floor(diffMinutes / 60)
      const mins = diffMinutes % 60
      
      if (mins === 0) {
        return `${hours}h`
      }
      
      return `${hours}h ${mins}m`
    }

    // Render card-based layout matching alert card style
    return (
      <Card
        ref={ref}
        className={cn(
          "rounded-lg group/card border border-scale-700 overflow-hidden cursor-pointer transition-shadow shadow-sm mb-2 hover:shadow-lg bg-scale-100",
          isSelected && "ring-2 ring-blue-500",
          isHovered && !isSelected && "ring-2 ring-yellow-400 bg-yellow-50/50 dark:bg-yellow-900/10"
        )}
        onClick={onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <CardContent className="p-0 flex flex-col">
          {/* Line 1: Road name + Severity Badge */}
          <div className="px-4 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {/* Road Name */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="text-md font-medium text-scale-1200 tracking-tight truncate uppercase">
                      {mainRoadNameWithoutId}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{mainRoadNameWithoutId}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            {question ? (
              renderQuestionRightContent()
            ) : (
              <div className="flex items-center gap-2 shrink-0">
                {/* Congestion Factor Badge */}
                {deviationIndex !== null && deviationIndex !== undefined && Math.round(deviationIndex * 10) / 10 > 1.0 ? (
                  <div className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-red-100 text-red-700">
                    <span className="font-numbers tabular-nums">{deviationIndex.toFixed(1)}x slower</span>
                  </div>
                ) : (
                  <div className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-green-100 text-green-700">
                    <span>No congestion</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="h-px bg-scale-500" />

          {/* Line 2: Metrics (speed, duration, distance) */}
          <div className="px-4 flex items-center justify-between flex-wrap gap-1 min-h-9 py-2">
            {/* Speed */}
            <div className="flex items-center gap-2">
              <Icon
                icon="icon-[ph--gauge-duotone]"
                className="text-icon-lg text-scale-1100 mt-0.5"
              />
              <span className="text-base font-numbers tabular-nums text-scale-1200">
                {currentSpeed} km/h
              </span>
            </div>

            {/* Vertical Divider */}
            <div className="self-stretch w-px bg-scale-500" />

            {/* Delay */}
            <div className="flex items-center gap-2">
              <Icon
                icon="icon-[ph--timer-duotone]"
                className="text-icon-lg text-scale-1100 mt-0.5"
              />
              <span className="text-base font-numbers tabular-nums text-scale-1200">
                {delayMinutes} min
              </span>
            </div>

            {/* Vertical Divider */}
            <div className="self-stretch w-px bg-scale-500" />

            {/* Distance */}
            <div className="flex items-center gap-2">
              <Icon
                icon="icon-[ph--path-duotone]"
                className="text-icon-lg text-scale-1100 mt-0.5"
              />
              <span className="text-base font-numbers tabular-nums text-scale-1200">
                {roadLengthKm} km
              </span>
            </div>
          </div>

          {/* Active Alert Section (if exists) */}
          {!question && road.active_alerts?.types && road.active_alerts.types.length > 0 && (
            <>
              <div className="h-px bg-scale-500" />
              <div className="px-4 py-2 bg-red-50 flex items-center gap-2">
                <Icon 
                  icon="icon-[ph--warning-circle-fill]" 
                  className="shrink-0 text-icon-sm text-red-600" 
                />
                <span className="text-sm font-medium text-red-900">
                  Active alert — Ongoing for {getAlertOngoingTime(road.active_alerts.most_recent_start_time || '')}
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    )
  }
)

RoadCard.displayName = "RoadCard"

