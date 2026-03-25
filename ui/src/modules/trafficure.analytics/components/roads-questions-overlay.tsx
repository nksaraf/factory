import { useContext, useState, useRef, useEffect } from "react"
import { useParams, useNavigate } from "react-router"
import { Icon } from "@rio.js/ui/icon"
import { Badge } from "@rio.js/ui/badge"
import { RoadsQueryContext } from "./roads-query-context"
import { useRoadsQuery, type TimeScope, type PeakType } from "../data/use-roads-query"
import { type Road } from "../roads-data"
import { cn } from "@rio.js/ui/lib/utils"

export interface QuestionCard {
  id: string
  name: string
  icon: string
  dropdownTitle: string
  sort: { key: string; sortOrder: "asc" | "desc" }
  filterFn?: (road: Road) => boolean
  badgeDisplay?: "count" | "time" // For Peak Hour, show time instead of count
}

export const QUESTION_CARDS: QuestionCard[] = [
  {
    id: "degrading_roads",
    name: "Degrading Roads",
    icon: "icon-[ph--arrow-down-duotone]",
    dropdownTitle: "Rapidly deteriorating roads",
    sort: { key: "severity", sortOrder: "desc" },
  },
  // {
  //   id: "hotspots_now",
  //   name: "Hotspots Now",
  //   icon: "icon-[ph--flame-duotone]",
  //   dropdownTitle: "Roads with Highest Congestion",
  //   sort: { key: "delay", sortOrder: "desc" },
  //   filterFn: (road) => road.delay_percent > 50,
  // },
  {
    id: "most_alerts",
    name: "Most Alerts",
    icon: "icon-[ph--warning-duotone]",
    dropdownTitle: "Roads with most number of alerts in last 7 days",
    sort: { key: "alerts", sortOrder: "desc" },
    filterFn: (road) => road.has_active_alert === true,
  },
  {
    id: "improving",
    name: "Improving Roads",
    icon: "icon-[ph--arrow-up-duotone]",
    dropdownTitle: "Roads that have improved significantly",
    sort: { key: "severity", sortOrder: "asc" },
  },
  {
    id: "peak_hour",
    name: "Peak Hour",
    icon: "icon-[ph--clock-duotone]",
    dropdownTitle: "Most congested roads during peak hours",
    sort: { key: "delay", sortOrder: "desc" },
  },
] as const

function RoadDropdownItem({ 
  road, 
  rank,
  question,
  onClose
}: { 
  road: Road
  rank: number
  question: QuestionCard
  onClose: () => void
}) {
  const navigate = useNavigate()
  const { roadId } = useParams()
  
  // Split road name by "/" to get city and main road name
  const roadNameParts = road.road_name.split("/")
  const city = roadNameParts.length > 1 ? roadNameParts[0].trim() : null
  const mainRoadName = roadNameParts.length > 1 ? roadNameParts[1].trim() : road.road_name

  const handleClick = () => {
    navigate(`/analytics/${road.road_id}`, { replace: true })
    onClose()
  }
  
  const isSelected = roadId === road.road_id

  // Render different content based on question type
  const renderRightContent = () => {
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
              <span className="text-base font-semibold text-red-600">↓ {Math.round(speedDrop * 10) / 10} km/h</span>
            </div>
            <span className="text-base text-scale-1000">Score: {degradationScore.toFixed(1)}</span>
          </div>
        )
      }
      case "hotspots_now": {
        // Current speed and delay
        const speed = Math.round(road.current_speed_kmph || 0)
        const delayPercent = Math.round(road.delay_percent || 0)
        return (
          <div className="flex flex-col items-end gap-1 shrink-0">
            <div className="flex items-center gap-1">
              <span className="text-base font-semibold text-scale-1200">{speed} km/h</span>
            </div>
            <div className="flex items-center gap-1">
              <Icon icon="icon-[ph--timer-duotone]" className="text-red-600 text-base" />
              <span className="text-base text-red-600">{delayPercent}% delay</span>
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
              <Icon icon="icon-[ph--shield-warning-duotone] -mt-0.5" className="text-orange-600 text-base" />
              <span className="text-base font-semibold text-orange-600">{alertCount} alerts</span>
            </div>
            {avgDuration !== undefined && avgDuration > 0 && (
              <span className="text-base text-scale-1000">Avg {avgDuration} min</span>
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
              <span className="text-base font-semibold text-green-600">↑ {Math.round(speedGain * 10) / 10} km/h</span>
            </div>
            <span className="text-base text-scale-1000">Score: {improvementScore.toFixed(1)}</span>
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
              <Icon icon="icon-[ph--clock-counter-clockwise-duotone] -mt-0.5" className="text-orange-600 text-base" />
              <span className="text-base font-semibold text-orange-600">{Math.round(severityScore)}%</span>
            </div>
            <span className="text-base text-scale-1000">Worst: {worstWindow}</span>
          </div>
        )
      }
      default: {
        // Fallback to delay percentage
        const delayPercent = Math.round(road.delay_percent || 0)
        return (
          <div className="flex items-center gap-2 shrink-0">
            <Icon icon="icon-[ph--arrow-down]" className="text-red-600 text-lg" />
            <span className="text-base font-semibold text-red-600">{delayPercent}%</span>
          </div>
        )
      }
    }
  }

  return (
    <div 
      className={cn(
        "px-4 py-3 cursor-pointer transition-all border-b border-scale-500/50 last:border-b-0",
        isSelected 
          ? "bg-teal-600/20 hover:bg-teal-600/30 hover:shadow-sm" 
          : "hover:bg-scale-200/70 hover:shadow-sm hover:translate-x-1"
      )}
      onClick={handleClick}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="text-base font-semibold text-scale-1100 shrink-0">#{rank}</span>
          <div className="min-w-0 flex-1">
            <div className={cn("font-medium truncate", isSelected && "text-teal-600 font-semibold")}>{mainRoadName}</div>
            {city && <div className="text-base text-scale-1000 truncate italic">{city}</div>}
          </div>
        </div>
        {renderRightContent()}
      </div>
    </div>
  )
}

function QuestionCardDropdown({
  question,
  roads,
  onClose,
  onViewAll,
}: {
  question: QuestionCard
  roads: Road[]
  onClose: () => void
  onViewAll: () => void
}) {
  const dropdownRef = useRef<HTMLDivElement>(null)
  const context = useContext(RoadsQueryContext)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (!target) return
      
      // Don't close if clicking inside the dropdown
      if (dropdownRef.current && dropdownRef.current.contains(target)) {
        return
      }
      
      // Close the dropdown
      onClose()
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [onClose])

  const displayedRoads = roads.slice(0, 12)
  const isRightAligned =
    question.id === "peak_hour" || question.id === "improving"
  const isCenterAligned = question.id === "most_alerts"

  const timeScope = context?.filters.timeScope || "this_week"
  const timeScopeOptions: { value: TimeScope; label: string }[] = [
    { value: "this_hour", label: "This Hour" },
    { value: "today", label: "Today" },
    { value: "this_week", label: "This Week" },
    { value: "this_month", label: "This Month" },
  ]

  const peakType = context?.filters.peakType || "evening-peak"
  const peakTypeOptions: { value: PeakType; label: string }[] = [
    { value: "morning-peak", label: "Morning Peak" },
    { value: "evening-peak", label: "Evening Peak" },
    { value: "shoulder-hours", label: "Shoulder Hours" },
  ]

  const handleTimeScopeChange = (newTimeScope: TimeScope) => {
    if (context) {
      context.setFilters({
        ...context.filters,
        timeScope: newTimeScope,
      })
    }
  }

  const handlePeakTypeChange = (newPeakType: PeakType) => {
    if (context) {
      context.setFilters({
        ...context.filters,
        peakType: newPeakType,
      })
    }
  }


  return (
    <div
      ref={dropdownRef}
      className={cn(
        "absolute top-full mt-2 bg-card/95 backdrop-blur-sm border-base border-scale-500 rounded-lg shadow-lg z-50",
        isRightAligned && "right-0 min-w-[400px] w-auto",
        isCenterAligned && "left-1/2 -translate-x-1/2 min-w-[400px] w-auto",
        !isRightAligned && !isCenterAligned && "left-0 w-[400px]"
      )}
    >
      <div className="px-4 py-3 border-b border-scale-500/50">
        <h3 className={cn(
          "font-semibold text-scale-1200 truncate",
          (question.id === "degrading_roads" || question.id === "improving" || question.id === "peak_hour") && "mb-3"
        )}>{question.dropdownTitle}</h3>
        {(question.id === "degrading_roads" || question.id === "improving") && (
          <div className="flex items-center justify-between gap-2">
            {timeScopeOptions.map((option) => {
              const isSelected = timeScope === option.value
              return (
                <button
                  key={option.value}
                  onClick={() => handleTimeScopeChange(option.value)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-full transition-all flex-1",
                    "border transition-colors",
                    isSelected
                      ? "bg-teal-600 text-white border-teal-600 shadow-sm"
                      : "bg-scale-100 text-scale-1100 border-scale-400 hover:bg-scale-200 hover:border-teal-500/50"
                  )}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        )}
        {question.id === "peak_hour" && (
          <div className="flex items-center justify-between gap-2">
            {peakTypeOptions.map((option) => {
              const isSelected = peakType === option.value
              return (
                <button
                  key={option.value}
                  onClick={() => handlePeakTypeChange(option.value)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-full transition-all flex-1",
                    "border transition-colors",
                    isSelected
                      ? "bg-teal-600 text-white border-teal-600 shadow-sm"
                      : "bg-scale-100 text-scale-1100 border-scale-400 hover:bg-scale-200 hover:border-teal-500/50"
                  )}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        )}
      </div>
      <div className="max-h-[400px] overflow-y-auto overflow-x-hidden pretty-scroll">
        {displayedRoads.length === 0 ? (
          <div className="px-4 py-8 text-center text-scale-1100">No roads found</div>
        ) : (
          displayedRoads.map((road, index) => (
            <RoadDropdownItem 
              key={road.road_id} 
              road={road} 
              rank={index + 1}
              question={question}
              onClose={onClose}
            />
          ))
        )}
      </div>
      {roads.length > 12 && (
        <div className="px-4 py-3 border-t border-scale-500/50">
          <button
            onClick={onViewAll}
            className="text-teal-600 hover:text-teal-800 font-medium text-base flex items-center gap-1 transition-colors cursor-pointer"
          >
            View all {roads.length} roads
            <Icon icon="icon-[ph--arrow-right]" className="text-lg" />
          </button>
        </div>
      )}
    </div>
  )
}

export function RoadsQuestionsOverlay() {
  const context = useContext(RoadsQueryContext)
  const { roadId } = useParams()
  const [openCardId, setOpenCardId] = useState<string | null>(null)
  const [isHidden, setIsHidden] = useState(false)

  if (!context) {
    return null
  }

  // Hide overlay when a road is selected
  if (roadId) {
    return null
  }



  const handleCardClick = (cardId: string) => {
    if (openCardId === cardId) {
      setOpenCardId(null)
    } else {
      setOpenCardId(cardId)
    }
  }

  const handleViewAll = (question: QuestionCard) => {
    // Just set the question - query will automatically handle sort and filters
    context.setSelectedQuestion(question.id)
    setOpenCardId(null)
  }

  const toggleHide = () => {
    setIsHidden((prev) => !prev)
    // Close any open dropdowns when hiding
    if (!isHidden) {
      setOpenCardId(null)
    }
  }

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-auto">
      <div className="flex items-center gap-2">
        {/* Hide/Show button - fixed on the left end */}
        {/* <button
          onClick={toggleHide}
          className="p-1.5 rounded-md border flex-shrink-0 bg-white hover:bg-scale-200 text-scale-1100 border-scale-600 shadow-sm transition-colors"
          aria-label={isHidden ? "Show questions" : "Hide questions"}
        >
          <Icon 
            icon={isHidden ? "icon-[ph--caret-left]" : "icon-[ph--caret-right]"} 
            className="text-lg" 
          />
        </button> */}
        {/* Questions cards container - slides out from button to the right */}
        <div
          className={cn(
            "flex items-center gap-2 transition-all duration-500 ease-in-out",
            isHidden 
              ? "translate-x-[600px] opacity-0 pointer-events-none" 
              : "translate-x-0 opacity-100"
          )}
        >
          {QUESTION_CARDS.map((question) => (
            <QuestionCardComponent
              key={question.id}
              question={question}
              isOpen={openCardId === question.id}
              onCardClick={() => handleCardClick(question.id)}
              onViewAll={() => handleViewAll(question)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function QuestionCardComponent({
  question,
  isOpen,
  onCardClick,
  onViewAll,
}: {
  question: QuestionCard
  isOpen: boolean
  onCardClick: () => void
  onViewAll: () => void
}) {
  const context = useContext(RoadsQueryContext)
  const { roadId } = useParams()
  if (!context) return null

  // Fetch roads - query automatically handles sort and filters based on question
  // Include timeScope filter for degrading roads and improving roads
  // Include peakType filter for peak hour
  const filters = (() => {
    if (question.id === "degrading_roads" || question.id === "improving") {
      return { timeScope: context.filters.timeScope || "this_week" }
    }
    if (question.id === "peak_hour") {
      return { peakType: context.filters.peakType || "evening-peak" }
    }
    return {}
  })()
  const { roads: sortedRoads } = useRoadsQuery(filters, { key: "severity", sortOrder: "desc" }, null, question.id)

  const roadCount = sortedRoads.length
  
  // Get badge display value
  const getBadgeValue = () => {
    if (question.badgeDisplay === "time") {
      // For Peak Hour, show current hour in 12-hour format
      const hour = new Date().getHours()
      const period = hour >= 12 ? "PM" : "AM"
      const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour
      return `${displayHour}${period}`
    }
    return roadCount > 0 ? roadCount.toString() : null
  }

  const badgeValue = getBadgeValue()

  const showCompact = !!roadId

  return (
    <div className="relative">
      <button
        onClick={onCardClick}
        className={cn(
          "relative flex items-center gap-2 rounded-md border-base transition-all whitespace-nowrap shadow-md backdrop-blur-sm cursor-pointer",
          showCompact ? "px-3 py-3" : "px-4 py-2.5 h-auto",
          isOpen
            ? "bg-teal-600/80 hover:bg-teal-700/85 text-white border-teal-600 shadow-lg hover:scale-105"
            : "bg-card/80 hover:bg-card/90 text-scale-1100 border-scale-500 shadow-md hover:shadow-lg hover:border-teal-500/50 hover:scale-105"
        )}
      >
        <Icon icon={question.icon} className={cn(showCompact ? "text-xl" : "text-lg", "shrink-0", isOpen ? "text-white" : "text-teal-600")} />
        {!showCompact && <span className="font-medium whitespace-nowrap">{question.name}</span>}
        {!showCompact && badgeValue && (
          <Badge
            className={cn(
              "ml-1 px-2 py-0.5 text-base font-semibold rounded-full min-w-[24px] flex items-center justify-center",
              isOpen
                ? "bg-white text-teal-600 border-0"
                : "bg-teal-600 text-white border-0"
            )}
          >
            {badgeValue}
          </Badge>
        )}
      </button>
      {isOpen && (
        <QuestionCardDropdown
          question={question}
          roads={sortedRoads}
          onClose={() => onCardClick()}
          onViewAll={onViewAll}
        />
      )}
    </div>
  )
}
