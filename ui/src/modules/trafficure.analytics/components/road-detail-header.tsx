import { useParams } from "react-router"
import { Button } from "@rio.js/ui/button"
import { Icon } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@rio.js/ui/tooltip"
import { useRoadHeaderDataQuery } from "../data/use-road-header-data-query"
import { useProject } from "@rio.js/gis/store"
import { useRio } from "@rio.js/client"

type Props = {
  onClose?: () => void
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

export function RoadDetailHeader({ onClose }: Props) {
  const { roadId } = useParams()
  const { data: road } = useRoadHeaderDataQuery(roadId)
  const project = useProject()
  const rio = useRio()

  if (!road) {
    return null
  }

  // Extract segment label and road name from road_name
  const fullRoadName = road.road_name || "Unknown Road"
  const nameParts = fullRoadName.split("/")
  const city = road.city || (nameParts.length > 1 ? nameParts[0].trim() : "")
  const mainRoadName = nameParts.length > 1 ? nameParts[1].trim() : fullRoadName
  // Remove ID from main road name (text in parentheses)
  const roadName = mainRoadName.replace(/\s*\([^)]+\)/, "")
  const roadIdLabel = extractRoadId(fullRoadName)
  const roadLengthKm = (road.road_length_meters / 1000).toFixed(1)

  return (
    <div className="px-6 py-3 border-b bg-white border-scale-500 flex flex-col gap-1 relative rounded-t-lg">
      {/* Line 1: Road name + Alert icon */}
      <div className="flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Show alert icon before road name when there's an active alert */}
          {road.active_alerts?.types && road.active_alerts.types.length > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <Icon 
                      icon="icon-[ph--warning-circle-fill]" 
                      className="text-red-600 text-xl shrink-0" 
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>The road is facing an active alert</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <h1 className="text-lg font-bold text-scale-1200 truncate">{roadName}</h1>
              </TooltipTrigger>
              <TooltipContent>
                <p>{roadName}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex items-center gap-2">
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                // Clear selected object so map no longer treats this road as selected
                if (project) {
                  project.delSelectedObjectRow("0")
                }
                // Clear any hover state (map + inbox) when closing detail
                rio.events.emit("road.hover", {
                  type: "road",
                  roadId: null,
                  road: null,
                  source: "detail-close",
                })
                onClose?.()
              }}
              className="shrink-0 text-scale-1200 hover:text-scale-1200"
            >
              <Icon icon="icon-[ph--x]" className="text-icon-lg" />
            </Button>
          )}
        </div>
      </div>

      {/* Line 2: City • Road ID • Length • Severity badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-base text-scale-1000 min-w-0">
          {city && <span className="truncate">{city}</span>}
          {city && roadIdLabel && <span>•</span>}
          {roadIdLabel && <span className="truncate">{roadIdLabel}</span>}
          {(city || roadIdLabel) && <span>•</span>}
          <span>{roadLengthKm} km</span>
        </div>
        {/* {road.severity && (() => {
          const badgeStyle = getSeverityBadgeStyle(road.severity.level)
          return (
            <div
              className={cn(
                "inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-medium shrink-0",
                badgeStyle.bg,
                badgeStyle.text,
                badgeStyle.border
              )}
            >
              <Icon
                icon={badgeStyle.icon}
                className={cn("text-icon-xs", badgeStyle.iconColor)}
              />
              <span className="uppercase">{road.severity.label}</span>
            </div>
          )
        })()} */}
      </div>
    </div>
  )
}

