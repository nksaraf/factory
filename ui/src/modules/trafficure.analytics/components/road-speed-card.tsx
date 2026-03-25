import { useParams } from "react-router"
import { useRoadSpeedMetricsQuery, InspectorRawMetricsDTO } from "../data/use-road-speed-metrics-query"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@rio.js/ui/tooltip"
import { Icon } from "@rio.js/ui/icon"

export function RoadSpeedCard() {
  const { roadId } = useParams()
  const { data } = useRoadSpeedMetricsQuery(roadId)

  if (!data) {
    return null
  }

  const metrics = data as InspectorRawMetricsDTO
  const {
    currentSpeedKmph,
    typicalSpeedKmph,
    freeflowSpeedKmph,
    delayMin,
    speedChange7dKmph,
    deviationIndex,
  } = metrics

  return (
    <div className="px-4 flex flex-col gap-2">
      <div className="rounded-lg border border-scale-500 bg-scale-100 p-4">
        <div className="flex flex-col gap-4">
          {/* Current Speed with Trend indicators */}
          <div className="flex justify-between items-stretch">
            <div className="flex flex-col">
              <div className="text-6xl font-bold text-scale-1200 leading-none">
                {currentSpeedKmph.toFixed(0)}{" "}
                <span className="text-2xl font-normal">km/h</span>
              </div>
              <div className="text-base text-scale-1100 mt-2 font-medium">
                Current Speed
              </div>
            </div>

            {/* Trend indicators - aligned with speed section */}
            <div className="flex flex-col items-end gap-2">
              {speedChange7dKmph !== null && (
                <div className="flex flex-col items-end">
                  {(() => {
                    const roundedChange = Math.round(speedChange7dKmph)
                    return (
                      <div
                        className={`text-lg font-bold leading-none ${
                          roundedChange === 0
                            ? "text-orange-600"
                            : roundedChange > 0
                            ? "text-emerald-600"
                            : "text-red-600"
                        }`}
                      >
                        {roundedChange === 0 ? "~" : roundedChange > 0 ? "↑" : "↓"}
                        {roundedChange === 0 ? " 0 km/h" : ` ${Math.abs(roundedChange)} km/h`}
                      </div>
                    )
                  })()}
                  <div className="flex items-center gap-1 text-base text-scale-1000">
                    7-Day change
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" className="inline-flex">
                            <Icon icon="icon-[ph--info]" className="text-icon-sm text-scale-1000 hover:text-scale-1200 mt-0" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p>Speed change of the last 7 days compared to the previous 7 days</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              )}
              <div className="flex flex-col items-end">
                <div className="text-lg font-bold leading-none text-orange-600">
                  N/A
                </div>
                <div className="flex items-center gap-1 text-base text-scale-1000">
                  30-Day change
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className="inline-flex">
                          <Icon icon="icon-[ph--info]" className="text-icon-sm text-scale-1000 hover:text-scale-1200 mt-0.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p>Speed change of the last 30 days compared to the previous 30 days</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            </div>
          </div>

          {/* 4 Metric Cards */}
          <div className="rounded-lg border border-scale-500 bg-scale-100 overflow-hidden">
            <div className="grid grid-cols-2">
              {/* Usual Speed Card */}
              <div className="border-scale-500 border-r border-b py-2.5 px-3 flex flex-col gap-0.5">
                <span className="text-sm text-scale-1000 leading-tight">Usual Speed</span>
                <span className="text-lg font-bold text-scale-1200 leading-tight">
                  {typicalSpeedKmph.toFixed(0)} km/h
                </span>
              </div>

              {/* Free Flow Speed Card */}
              <div className="border-scale-500 border-b py-2.5 px-3 flex flex-col gap-0.5">
                <span className="text-sm text-scale-1000 leading-tight">Free Flow Speed</span>
                <span className="text-lg font-bold text-scale-1200 leading-tight">
                  {freeflowSpeedKmph.toFixed(0)} km/h
                </span>
              </div>

              {/* Current Delay Card */}
              <div className="border-scale-500 border-r py-2.5 px-3 flex flex-col gap-0.5">
                <span className="text-sm text-scale-1000 leading-tight">Current Congestion Factor</span>
                {(() => {
                  if (deviationIndex !== null && deviationIndex > 1) {
                    return (
                      <span className="text-lg font-bold leading-tight text-amber-600">
                        {deviationIndex.toFixed(1)}x Slower
                      </span>
                    )
                  }
                  return (
                    <span className="text-lg font-bold leading-tight text-emerald-600">
                      Normal
                    </span>
                  )
                })()}
              </div>

              {/* Delay Mins Card - Replaced with Current Delay showing minutes */}
              <div className="border-scale-500 py-2.5 px-3 flex flex-col gap-0.5">
                <span className="text-sm text-scale-1000 leading-tight">Current Delay</span>
                {(() => {
                  const roundedDelayMin = Math.round(delayMin)
                  return (
                    <span className={`text-lg font-bold leading-tight ${
                      roundedDelayMin > 0 ? "text-red-600" : "text-emerald-600"
                    }`}>
                      {roundedDelayMin} min
                    </span>
                  )
                })()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

