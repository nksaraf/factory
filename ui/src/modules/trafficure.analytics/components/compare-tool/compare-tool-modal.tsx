import { useState, useMemo } from "react"
import { Dialog, DialogContent } from "@rio.js/ui/dialog"
import { Button } from "@rio.js/ui/button"
import { Icon } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"
import { DateSelectionStep } from "./components/date-selection-step"
import { RoadSelectionStep } from "./components/road-selection-step"
import { ResultsStep } from "./components/results-step"
import { useCompareData } from "./hooks/use-compare-data"
import { ComparisonParams } from "./types"
import { useRoadsQuery } from "../../data/use-roads-query"

interface CompareToolModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CompareToolModal({ open, onOpenChange }: CompareToolModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [beforeStartDate, setBeforeStartDate] = useState<Date | null>(null)
  const [beforeEndDate, setBeforeEndDate] = useState<Date | null>(null)
  const [afterStartDate, setAfterStartDate] = useState<Date | null>(null)
  const [afterEndDate, setAfterEndDate] = useState<Date | null>(null)
  const [selectedRoadId, setSelectedRoadId] = useState<string | null>(null)

  // Get road name for the selected road
  const { roads } = useRoadsQuery({}, { key: "name", sortOrder: "asc" }, null, null)
  const selectedRoad = selectedRoadId ? roads.find(r => r.road_id === selectedRoadId) : null

  // Prepare comparison params for API call
  const comparisonParams: ComparisonParams | null = useMemo(() => {
    if (!beforeStartDate || !beforeEndDate || !afterStartDate || !afterEndDate || !selectedRoadId || !selectedRoad) {
      return null
    }
    return {
      beforeStartDate,
      beforeEndDate,
      afterStartDate,
      afterEndDate,
      roadId: selectedRoadId,
      roadName: selectedRoad.road_name
    }
  }, [beforeStartDate, beforeEndDate, afterStartDate, afterEndDate, selectedRoadId, selectedRoad])

  const { data: comparisonResult, isLoading } = useCompareData(comparisonParams)

  const handleBeforeDateChange = (start: Date | null, end: Date | null) => {
    setBeforeStartDate(start)
    setBeforeEndDate(end)
  }

  const handleAfterDateChange = (start: Date | null, end: Date | null) => {
    setAfterStartDate(start)
    setAfterEndDate(end)
  }

  const handleNext = () => {
    if (step === 1) {
      // Validate dates before moving to step 2
      if (beforeStartDate && beforeEndDate && afterStartDate && afterEndDate) {
        setStep(2)
      }
    } else if (step === 2) {
      // Validate road selection before moving to step 3
      if (selectedRoadId) {
        setStep(3)
      }
    }
  }

  const handleBack = () => {
    if (step === 2) {
      setStep(1)
    } else if (step === 3) {
      setStep(2)
    }
  }

  const handleCancel = () => {
    onOpenChange(false)
    // Reset state
    setStep(1)
    setBeforeStartDate(null)
    setBeforeEndDate(null)
    setAfterStartDate(null)
    setAfterEndDate(null)
    setSelectedRoadId(null)
  }

  const handleRunAnother = () => {
    setStep(1)
    setBeforeStartDate(null)
    setBeforeEndDate(null)
    setAfterStartDate(null)
    setAfterEndDate(null)
    setSelectedRoadId(null)
  }

  const canProceedFromStep1 = beforeStartDate && beforeEndDate && afterStartDate && afterEndDate
  const canProceedFromStep2 = selectedRoadId !== null
  const canProceedFromStep3 = comparisonResult !== undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-3">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-scale-600 mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-scale-1200">Compare Traffic Periods</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={handleCancel}>
            <Icon icon="icon-[ph--x]" className="h-4 w-4" />
          </Button>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-between pb-3 mb-3">
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold",
              step >= 1 ? "bg-teal-600 text-white" : "bg-scale-600 text-scale-1100"
            )}>
              {step > 1 ? <Icon icon="icon-[ph--check]" className="h-4 w-4" /> : "1"}
            </div>
            <span className={cn(
              "text-sm font-medium",
              step >= 1 ? "text-scale-1200" : "text-scale-1100"
            )}>
              1. Select Dates
            </span>
          </div>

          <div className="flex-1 h-px bg-scale-600 mx-4" />

          <div className="flex items-center gap-2">
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold",
              step >= 2 ? "bg-teal-600 text-white" : "bg-scale-600 text-scale-1100"
            )}>
              {step > 2 ? <Icon icon="icon-[ph--check]" className="h-4 w-4" /> : "2"}
            </div>
            <span className={cn(
              "text-sm font-medium",
              step >= 2 ? "text-scale-1200" : "text-scale-1100"
            )}>
              2. Choose Roads
            </span>
          </div>

          <div className="flex-1 h-px bg-scale-600 mx-4" />

          <div className="flex items-center gap-2">
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold",
              step >= 3 ? "bg-teal-600 text-white" : "bg-scale-600 text-scale-1100"
            )}>
              3
            </div>
            <span className={cn(
              "text-sm font-medium",
              step >= 3 ? "text-scale-1200" : "text-scale-1100"
            )}>
              3. View Results
            </span>
          </div>
        </div>

        {/* Step Content */}
        <div className="flex-1 overflow-y-auto pretty-scroll pr-2 min-h-0">
          {step === 1 && (
            <DateSelectionStep
              beforeStartDate={beforeStartDate}
              beforeEndDate={beforeEndDate}
              afterStartDate={afterStartDate}
              afterEndDate={afterEndDate}
              onBeforeDateChange={handleBeforeDateChange}
              onAfterDateChange={handleAfterDateChange}
            />
          )}

          {step === 2 && (
            <RoadSelectionStep
              selectedRoadId={selectedRoadId}
              beforeStartDate={beforeStartDate}
              beforeEndDate={beforeEndDate}
              afterStartDate={afterStartDate}
              afterEndDate={afterEndDate}
              onRoadChange={setSelectedRoadId}
            />
          )}

          {step === 3 && comparisonResult && (
            <ResultsStep
              result={comparisonResult}
              beforeStartDate={beforeStartDate}
              beforeEndDate={beforeEndDate}
              afterStartDate={afterStartDate}
              afterEndDate={afterEndDate}
            />
          )}

          {step === 3 && isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-scale-1100">Loading comparison data...</div>
            </div>
          )}
        </div>

        {/* Footer */}
        {step !== 3 && (
          <div className="flex items-center justify-between pt-3 mt-3 border-t border-scale-600 flex-shrink-0">
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <div className="flex items-center gap-2">
              {step > 1 && (
                <Button variant="outline" onClick={handleBack}>
                  Back
                </Button>
              )}
              <Button
                onClick={handleNext}
                disabled={
                  (step === 1 && !canProceedFromStep1) ||
                  (step === 2 && !canProceedFromStep2)
                }
                className="bg-teal-600 hover:bg-teal-700 text-white border border-teal-600 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="flex items-center gap-2">
                {step === 1 ? "Next" : "Compare"}
                <Icon icon="icon-[ph--arrow-right]" className="h-4 w-4 " />
                </span>
              </Button>
            </div>
          </div>
        )}

        {/* Footer for Step 3 */}
        {step === 3 && comparisonResult && (
          <div className="flex items-center justify-between pt-3 mt-3 border-t border-scale-600 flex-shrink-0">
            <Button
              onClick={handleRunAnother}
              className="bg-teal-600 hover:bg-teal-700 text-white border border-teal-600 shadow-sm hover:shadow-md"
            >
              <span className="flex items-center gap-2">
                <Icon icon="icon-[ph--arrow-counter-clockwise]" className="h-4 w-4" />
                Run Another Comparison
              </span>
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="border-scale-600 hover:bg-scale-100 hover:border-scale-700 shadow-sm hover:shadow-md"
              >
                <span className="flex items-center gap-2">
                  <Icon icon="icon-[ph--file-pdf]" className="h-4 w-4" />
                  Export as PDF
                </span>
              </Button>
              <Button
                variant="outline"
                className="border-scale-600 hover:bg-scale-100 hover:border-scale-700 shadow-sm hover:shadow-md"
              >
                <span className="flex items-center gap-2">
                  <Icon icon="icon-[ph--share]" className="h-4 w-4" />
                  Share Results
                </span>
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

