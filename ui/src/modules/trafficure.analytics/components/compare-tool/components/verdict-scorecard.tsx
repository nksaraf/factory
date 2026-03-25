import { CalculatedMetrics } from "../types"
import { Icon } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"

interface VerdictScorecardProps {
  metrics: CalculatedMetrics
}

export function VerdictScorecard({ metrics }: VerdictScorecardProps) {
  const { speedChange, timeSaved, economicImpact, congestionIndex } = metrics

  const formatCurrency = (value: number) => {
    if (value >= 100) {
      return `₹${(value / 100).toFixed(1)}L`
    }
    return `₹${value.toFixed(0)}K`
  }

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-scale-1200">Verdict Scorecard</h3>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Speed Change */}
        <div className="p-3 border border-scale-600 rounded-lg bg-scale-200">
          <div className="text-sm font-medium text-scale-1100 mb-2">Speed Change</div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg font-semibold text-scale-1200">
              {speedChange.before.toFixed(0)} km/h
            </span>
            <Icon icon="icon-[ph--arrow-right]" className="h-4 w-4 text-scale-1100" />
            <span className="text-lg font-semibold text-scale-1200">
              {speedChange.after.toFixed(0)} km/h
            </span>
          </div>
          <div className={cn(
            "text-sm font-medium",
            speedChange.change > 0 ? "text-teal-600" : speedChange.change < 0 ? "text-red-600" : "text-scale-1100"
          )}>
            {speedChange.change > 0 ? "+" : ""}{speedChange.percentage.toFixed(0)}% {speedChange.change > 0 ? "IMPROVED" : speedChange.change < 0 ? "DEGRADED" : "UNCHANGED"}
          </div>
        </div>

        {/* Time Saved */}
        <div className="p-3 border border-scale-600 rounded-lg bg-scale-200">
          <div className="text-sm font-medium text-scale-1100 mb-2">Time Saved</div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg font-semibold text-scale-1200">
              {timeSaved.before.toFixed(1)} min
            </span>
            <Icon icon="icon-[ph--arrow-right]" className="h-4 w-4 text-scale-1100" />
            <span className="text-lg font-semibold text-scale-1200">
              {timeSaved.after.toFixed(1)} min
            </span>
          </div>
          <div className={cn(
            "text-sm font-medium",
            timeSaved.saved < 0 ? "text-teal-600" : timeSaved.saved > 0 ? "text-red-600" : "text-scale-1100"
          )}>
            {timeSaved.saved < 0 ? "" : "+"}{timeSaved.saved.toFixed(1)} min {timeSaved.saved < 0 ? "FASTER" : timeSaved.saved > 0 ? "SLOWER" : "UNCHANGED"}
          </div>
        </div>

        {/* Economic Impact */}
        <div className="p-3 border border-scale-600 rounded-lg bg-scale-200">
          <div className="text-sm font-medium text-scale-1100 mb-2">Economic Impact</div>
          {economicImpact.hasData ? (
            <>
              <div className="text-lg font-semibold text-scale-1200 mb-1">
                {formatCurrency(economicImpact.value * 100000)}
              </div>
              <div className="text-xs text-scale-1100">
                Estimated monthly savings
              </div>
              <div className="text-xs text-scale-900 mt-1">
                Based on {economicImpact.vehicleCount.toLocaleString()} vehicles/day
              </div>
            </>
          ) : (
            <div className="text-sm text-scale-1100">
              Economic impact: Insufficient data — vehicle counts needed.
            </div>
          )}
        </div>

        {/* Congestion Index */}
        <div className="p-3 border border-scale-600 rounded-lg bg-scale-200">
          <div className="text-sm font-medium text-scale-1100 mb-2">Congestion Index (BTI)</div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg font-semibold text-scale-1200">
              {congestionIndex.before.toFixed(1)}
            </span>
            <Icon icon="icon-[ph--arrow-right]" className="h-4 w-4 text-scale-1100" />
            <span className="text-lg font-semibold text-scale-1200">
              {congestionIndex.after.toFixed(1)}
            </span>
          </div>
          <div className={cn(
            "text-sm font-medium",
            congestionIndex.change < 0 ? "text-teal-600" : congestionIndex.change > 0 ? "text-red-600" : "text-scale-1100"
          )}>
            {congestionIndex.change < 0 ? "" : "+"}{congestionIndex.percentage.toFixed(0)}% {congestionIndex.change < 0 ? "IMPROVED" : congestionIndex.change > 0 ? "DEGRADED" : "UNCHANGED"}
          </div>
          <div className="text-xs text-scale-1100 mt-1">
            Worst-case travel takes {congestionIndex.after.toFixed(1)}x longer than free-flow
          </div>
        </div>
      </div>
    </div>
  )
}

