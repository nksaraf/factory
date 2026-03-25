import { useTransition } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@rio.js/ui/select"
import { Icon } from "@rio.js/ui/icon"
import { env } from "@rio.js/env"
import { ItemsSearchbar } from "./items-searchbar"
import { RoadsInboxFilters } from "./roads-inbox-filters"
import { QuestionCardHeader } from "./question-card-header"
import { CompareToolButton } from "./compare-tool/compare-tool-button"
import { QUESTION_CARDS } from "./roads-questions-overlay"
import { type RoadsSort, type TimeScope, type PeakType } from "../data/use-roads-query"

interface RoadsInboxHeaderProps {
  selectedQuestion: string | null
  filters: { searchTerm?: string; timeScope?: TimeScope; peakType?: PeakType }
  sort: RoadsSort
  count: number | null
  isMobile: boolean
  onFiltersChange: (filters: { searchTerm?: string; timeScope?: TimeScope; peakType?: PeakType }) => void
  onSortChange: (sort: RoadsSort) => void
  onCountChange: (count: number | null) => void
  onQuestionChange: (question: string | null) => void
}

export function RoadsInboxHeader({
  selectedQuestion,
  filters,
  sort,
  count,
  isMobile,
  onFiltersChange,
  onSortChange,
  onCountChange,
  onQuestionChange,
}: RoadsInboxHeaderProps) {
  const [, startTransition] = useTransition()
  const isCompareToolEnabled = env.PUBLIC_ENABLE_COMPARE_TOOL === "true"
  const isSmartFiltersEnabled = env.PUBLIC_ENABLE_SMART_FILTERS === "true"

  const selectedQuestionCard = selectedQuestion
    ? QUESTION_CARDS.find((q) => q.id === selectedQuestion)
    : null

  const handleCloseQuestion = () => {
    startTransition(() => {
      onQuestionChange(null)
    })
  }

  const handleTimeScopeChange = (value: TimeScope) => {
    onFiltersChange({ ...filters, timeScope: value })
  }

  const handlePeakTypeChange = (value: PeakType) => {
    onFiltersChange({ ...filters, peakType: value })
  }

  const handleSearchChange = (searchTerm: string) => {
    onFiltersChange({ ...filters, searchTerm })
  }

  const handleQuestionSelect = (value: string) => {
    startTransition(() => {
      onQuestionChange(value || null)
    })
  }

  return (
    <div className="px-3 sm:px-4 py-2.5 sm:py-3 border-b border-scale-600 bg-scale-200">
      {selectedQuestionCard ? (
        <QuestionCardHeader
          questionCard={selectedQuestionCard}
          timeScope={filters.timeScope || "this_week"}
          peakType={filters.peakType || "evening-peak"}
          isMobile={isMobile}
          onClose={handleCloseQuestion}
          onTimeScopeChange={handleTimeScopeChange}
          onPeakTypeChange={handlePeakTypeChange}
        />
      ) : (
        <div className="flex flex-col w-full gap-2 sm:gap-3">
          <div className="w-full flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <ItemsSearchbar
                value={filters.searchTerm || ""}
                onSearchChange={handleSearchChange}
              />
            </div>
            {isCompareToolEnabled && (
              <div className="shrink-0">
                <CompareToolButton />
              </div>
            )}
            {isMobile && isSmartFiltersEnabled && (
              <Select value={selectedQuestion || ""} onValueChange={handleQuestionSelect}>
                <SelectTrigger className="h-9 w-auto min-w-[120px] shrink-0">
                  <SelectValue placeholder="Smart Insights" className="text-base">
                    {selectedQuestionCard ? (
                      <div className="flex items-center gap-1.5">
                        <Icon icon={selectedQuestionCard.icon} className="text-base shrink-0" />
                        <span className="truncate">{selectedQuestionCard.name}</span>
                      </div>
                    ) : (
                      "Smart Insights"
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="z-[50000]">
                  {QUESTION_CARDS.map((question) => (
                    <SelectItem key={question.id} value={question.id} className="text-base">
                      <div className="flex items-center gap-2">
                        <Icon icon={question.icon} className="text-base shrink-0" />
                        <span className="text-base">{question.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <RoadsInboxFilters
            sort={sort}
            count={count}
            isMobile={isMobile}
            onSortChange={onSortChange}
            onCountChange={onCountChange}
          />
        </div>
      )}
    </div>
  )
}

