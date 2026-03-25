import { Insight } from "../types"
import { Icon } from "@rio.js/ui/icon"

interface InsightsSummaryProps {
  insights: Insight[]
}

export function InsightsSummary({ insights }: InsightsSummaryProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-scale-1200">Insights Summary</h3>
      
      {/* Key Insights Box */}
      <div className="bg-yellow-50/80 border border-yellow-200/60 rounded-lg p-4 shadow-sm">
        <div className="space-y-2.5">
          {insights.map((insight, index) => (
            <div
              key={index}
              className="flex items-start gap-3"
            >
              <Icon
                icon="icon-[ph--check-circle-fill]"
                className="h-5 w-5 mt-0.5 shrink-0 text-green-600"
              />
              <span className="text-sm text-scale-1200 leading-relaxed">
                {insight.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

