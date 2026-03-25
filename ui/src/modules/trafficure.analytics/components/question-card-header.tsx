import { useTransition } from "react"
import { Icon } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"
import { type QuestionCard } from "./roads-questions-overlay"
import { type TimeScope, type PeakType } from "../data/use-roads-query"
import { TimeScopeSelector } from "./time-scope-selector"
import { PeakTypeSelector } from "./peak-type-selector"

interface QuestionCardHeaderProps {
  questionCard: QuestionCard
  timeScope: TimeScope
  peakType: PeakType
  isMobile: boolean
  onClose: () => void
  onTimeScopeChange: (value: TimeScope) => void
  onPeakTypeChange: (value: PeakType) => void
}

export function QuestionCardHeader({
  questionCard,
  timeScope,
  peakType,
  isMobile,
  onClose,
  onTimeScopeChange,
  onPeakTypeChange,
}: QuestionCardHeaderProps) {
  const [, startTransition] = useTransition()

  const handleClose = () => {
    startTransition(() => {
      onClose()
    })
  }

  const showSelectors =
    questionCard.id === "degrading_roads" ||
    questionCard.id === "improving" ||
    questionCard.id === "peak_hour"

  return (
    <div
      className={cn(
        "flex flex-col",
        showSelectors && "gap-2"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <button
            onClick={handleClose}
            className="p-1.5 hover:bg-scale-300 rounded transition-colors flex-shrink-0"
            aria-label="Back to normal view"
          >
            <Icon icon="icon-[ph--arrow-left]" className="text-scale-1100 text-lg" />
          </button>
          <span
            className={cn(
              "text-lg font-semibold text-scale-1200",
              isMobile && "truncate"
            )}
          >
            {questionCard.dropdownTitle}
          </span>
        </div>
        <Icon icon={questionCard.icon} className="text-2xl shrink-0 text-teal-600" />
      </div>
      {(questionCard.id === "degrading_roads" || questionCard.id === "improving") && (
        <TimeScopeSelector value={timeScope} onChange={onTimeScopeChange} />
      )}
      {questionCard.id === "peak_hour" && (
        <PeakTypeSelector value={peakType} onChange={onPeakTypeChange} />
      )}
    </div>
  )
}

