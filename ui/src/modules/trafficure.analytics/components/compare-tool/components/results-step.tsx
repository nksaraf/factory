import { format } from "date-fns"
import { ComparisonResult } from "../types"
import { VerdictScorecard } from "./verdict-scorecard"
import { ComparisonHeatmaps } from "./comparison-heatmaps"
import { InsightsSummary } from "./insights-summary"
import { useCompareCalculations } from "../hooks/use-compare-calculations"

interface ResultsStepProps {
  result: ComparisonResult
  beforeStartDate: Date | null
  beforeEndDate: Date | null
  afterStartDate: Date | null
  afterEndDate: Date | null
}

export function ResultsStep({
  result,
  beforeStartDate,
  beforeEndDate,
  afterStartDate,
  afterEndDate
}: ResultsStepProps) {
  const calculations = useCompareCalculations(result)

  const formatPeriod = (start: Date | null, end: Date | null) => {
    if (!start || !end) return ""
    return `${format(start, "MMM yyyy")} vs ${format(end, "MMM yyyy")}`
  }

  const periodText = formatPeriod(beforeStartDate, afterEndDate)

  if (!calculations) {
    return <div>Loading calculations...</div>
  }

  return (
    <div className="space-y-4 overflow-x-hidden">
      {/* Header */}
      <div className="pb-3 border-b border-scale-600">
        <h2 className="text-xl font-bold text-scale-1200">Comparison Results</h2>
        <div className="text-sm text-scale-1100 mt-1">
          {result.roadName} • {periodText}
        </div>
      </div>

      {/* Content */}
      <div className="space-y-3">
        {/* Section 1: Verdict Scorecard */}
        <VerdictScorecard metrics={calculations.metrics} />

        {/* Section 2: Side by Side Heatmaps */}
        <div className="pt-4 border-t border-scale-600">
          <ComparisonHeatmaps 
            result={result}
            beforeStartDate={beforeStartDate}
            beforeEndDate={beforeEndDate}
            afterStartDate={afterStartDate}
            afterEndDate={afterEndDate}
          />
        </div>

        {/* Section 3: Insights Summary */}
        <div className="pt-4 border-t border-scale-600">
          <InsightsSummary insights={calculations.insights} />
        </div>
      </div>
    </div>
  )
}

