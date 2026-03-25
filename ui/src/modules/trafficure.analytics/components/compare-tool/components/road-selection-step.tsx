import { format } from "date-fns"
import { useMemo } from "react"

import { Icon } from "@rio.js/ui/icon"

import { useRoadsQuery } from "../../../data/use-roads-query"
import { RoadCombobox } from "./road-combobox"

interface RoadSelectionStepProps {
  selectedRoadId: string | null
  beforeStartDate: Date | null
  beforeEndDate: Date | null
  afterStartDate: Date | null
  afterEndDate: Date | null
  onRoadChange: (roadId: string | null) => void
}

export function RoadSelectionStep({
  selectedRoadId,
  beforeStartDate,
  beforeEndDate,
  afterStartDate,
  afterEndDate,
  onRoadChange,
}: RoadSelectionStepProps) {
  const { roads, isLoading } = useRoadsQuery(
    {},
    { key: "name", sortOrder: "asc" },
    null,
    null
  )

  // Keep reference to selected road to prevent disappearing during refetch
  const selectedRoad = useMemo(() => {
    if (!selectedRoadId) return null
    const road = roads.find((r) => r.road_id === selectedRoadId)
    // If road is not found but we have an ID, it might be loading - return a placeholder
    if (!road && roads.length === 0 && isLoading) {
      return null // Still loading, don't show preview yet
    }
    return road || null
  }, [selectedRoadId, roads, isLoading])

  // Convert roads to options format
  const roadOptions = useMemo(() => {
    return roads.map((road) => ({
      value: road.road_id,
      label: road.road_name,
    }))
  }, [roads])

  const formatPeriod = (start: Date | null, end: Date | null) => {
    if (!start || !end) return ""
    return `${format(start, "MMM yyyy")}`
  }

  const beforePeriod = formatPeriod(beforeStartDate, beforeEndDate)
  const afterPeriod = formatPeriod(afterStartDate, afterEndDate)

  return (
    <div className="space-y-6">
      {/* Section 2 - Segment Selection */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-scale-1100 uppercase tracking-wide">
          Section 2 - Segment Selection
        </div>

        <RoadCombobox
          options={roadOptions}
          value={selectedRoadId}
          onValueChange={onRoadChange}
          placeholder="Select your road segment"
          searchPlaceholder="Search roads..."
          emptyMessage="No roads found"
          loading={isLoading}
        />
      </div>

      {/* Comparison Preview */}
      {beforePeriod && afterPeriod && selectedRoad && (
        <div className="space-y-2 p-4 bg-scale-200 rounded-lg border border-scale-600">
          <div className="flex items-center gap-2">
            <div className="text-xs font-semibold text-scale-1100 uppercase tracking-wide">
              Comparison Preview
            </div>
            <Icon
              icon="icon-[ph--chart-bar]"
              className="h-4 w-4 text-scale-1100"
            />
          </div>
          <div className="text-sm text-scale-1200">
            Comparing: Before ({beforePeriod}) vs After ({afterPeriod})
          </div>
          <div className="text-sm text-scale-1200">
            Road: {selectedRoad.road_name}
          </div>
        </div>
      )}
    </div>
  )
}
