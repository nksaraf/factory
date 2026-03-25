import { useEffect, useRef, useState, useTransition } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rio.js/ui/select"
import { Icon, Icons } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"
import { type RoadsSort } from "../data/use-roads-query"

const SORT_OPTIONS = [
  { value: "severity", label: "Severity" },
  { value: "delay", label: "Delay" },
  { value: "speed", label: "Speed" },
  { value: "name", label: "Name" },
] as const

const COUNT_OPTIONS = [
  { value: "10", label: "Top 10" },
  { value: "20", label: "Top 20" },
  { value: "50", label: "Top 50" },
  { value: "100", label: "Top 100" },
  { value: "all", label: "All" },
] as const

interface RoadsInboxFiltersProps {
  sort: RoadsSort
  count: number | null
  isMobile: boolean
  onSortChange: (sort: RoadsSort) => void
  onCountChange: (count: number | null) => void
}

export function RoadsInboxFilters({
  sort,
  count,
  isMobile,
  onSortChange,
  onCountChange,
}: RoadsInboxFiltersProps) {
  const filtersRowRef = useRef<HTMLDivElement>(null)
  const [showSortByLabel, setShowSortByLabel] = useState(true)
  const [showShowLabel, setShowShowLabel] = useState(true)
  const [showSortOrderButtons, setShowSortOrderButtons] = useState(true)
  const [showSortOrderLabels, setShowSortOrderLabels] = useState(true)
  
  // Individual pending states for each control
  const [isSortPending, startSortTransition] = useTransition()
  const [isCountPending, startCountTransition] = useTransition()
  const [isSortOrderPending, startSortOrderTransition] = useTransition()

  const countValue = count === null ? "all" : count.toString()

  useEffect(() => {
    const filtersRow = filtersRowRef.current
    if (!filtersRow) {
      setShowShowLabel(true)
      setShowSortByLabel(true)
      setShowSortOrderButtons(true)
      setShowSortOrderLabels(true)
      return
    }

    const updateVisibility = (width: number) => {
      if (isMobile) {
        setShowShowLabel(false)
        setShowSortByLabel(false)
        setShowSortOrderButtons(true)
        setShowSortOrderLabels(false)
      } else {
        // Progressive visibility thresholds for desktop (hiding in order to prevent collisions)
        // Priority: Labels first, then Asc/Desc text, then entire buttons
        // Very narrow (< 280px): Hide sort order buttons entirely
        // Narrow (280-350px): Show buttons with icons only (no Asc/Desc labels)
        // Medium (350-420px): Show buttons with Asc/Desc labels, but hide "Sort by:" and "Show:" labels
        // Wide (420-500px): Show "Sort by:" label, but hide "Show:" label
        // Very wide (>= 500px): Everything visible
        setShowSortOrderButtons(width >= 280)
        setShowSortOrderLabels(width >= 350)
        setShowSortByLabel(width >= 420)
        setShowShowLabel(width >= 500)
      }
    }

    updateVisibility(filtersRow.offsetWidth)

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        updateVisibility(entry.contentRect.width)
      }
    })

    resizeObserver.observe(filtersRow)

    return () => {
      resizeObserver.disconnect()
    }
  }, [isMobile])

  const handleSortChange = (value: string) => {
    startSortTransition(() => {
      onSortChange({ key: value, sortOrder: sort.sortOrder })
    })
  }

  const handleCountChange = (value: string) => {
    const newCount = value === "all" ? null : parseInt(value, 10)
    startCountTransition(() => {
      onCountChange(newCount)
    })
  }

  const handleSortOrderChange = (newSortOrder: "asc" | "desc") => {
    startSortOrderTransition(() => {
      onSortChange({
        key: sort.key,
        sortOrder: newSortOrder,
      })
    })
  }

  if (isMobile) {
    return (
      <div ref={filtersRowRef} className="flex items-center w-full min-w-0 gap-2">
        <div className="relative flex-1 min-w-[100px]"> 
          <Select value={sort.key} onValueChange={handleSortChange} disabled={isSortPending}>
            <SelectTrigger className="h-9 w-full" aria-busy={isSortPending}>
              <SelectValue placeholder="Sort by..." className="text-base">
                {isSortPending ? (
                  <div className="flex items-center gap-2">
                    <Icon icon={Icons.spinner} className="animate-spin text-xl text-scale-900" />
                  </div>
                ) : (
                  SORT_OPTIONS.find((opt) => opt.value === sort.key)?.label
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="z-[50000]">
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value} className="text-base">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="relative flex-1 min-w-[90px]">
          <Select value={countValue} onValueChange={handleCountChange} disabled={isCountPending}>
            <SelectTrigger className="h-9 w-full" title="Show top N roads" aria-busy={isCountPending}>
              <SelectValue placeholder="Limit..." className="text-base">
                {isCountPending ? (
                  <div className="flex items-center gap-2">
                    <Icon icon={Icons.spinner} className="animate-spin text-xl text-scale-900" />
                  </div>
                ) : (
                  COUNT_OPTIONS.find((opt) => opt.value === countValue)?.label
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="z-[50000]">
              {COUNT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value} className="text-base">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {showSortOrderButtons && (
          <div className="flex items-center h-9 rounded-md border border-scale-600 bg-scale-100 overflow-hidden shrink-0 min-w-[70px] relative">
            <button
              onClick={() => handleSortOrderChange("asc")}
              disabled={isSortOrderPending}
              className={cn(
                "flex items-center justify-center gap-1.5 px-2 h-full text-sm font-medium transition-colors flex-1",
                "border-r border-scale-600",
                sort.sortOrder === "asc"
                  ? "bg-scale-1200 text-white"
                  : "bg-scale-50 text-scale-1100 hover:bg-scale-200",
                isSortOrderPending && "opacity-50 cursor-not-allowed"
              )}
              title="Ascending"
            >
              <Icon icon="icon-[ph--arrow-up]" className="text-base" />
              {!isMobile && <span className="text-xs">Asc</span>}
            </button>
            <button
              onClick={() => handleSortOrderChange("desc")}
              disabled={isSortOrderPending}
              className={cn(
                "flex items-center justify-center gap-1.5 px-2 h-full text-sm font-medium transition-colors flex-1",
                sort.sortOrder === "desc"
                  ? "bg-scale-1200 text-white"
                  : "bg-scale-50 text-scale-1100 hover:bg-scale-200",
                isSortOrderPending && "opacity-50 cursor-not-allowed"
              )}
              title="Descending"
            >
              <Icon icon="icon-[ph--arrow-down]" className="text-base" />
              {!isMobile && <span className="text-xs">Desc</span>}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={filtersRowRef} className="flex items-center w-full min-w-0 gap-1.5 sm:gap-2 md:gap-3">
      <div className="flex items-center gap-1 sm:gap-1.5 md:gap-2.5 min-w-0 flex-1">
        {showSortByLabel && (
          <span className="text-base text-scale-1100 whitespace-nowrap shrink-0">Sort by:</span>
        )}
        <div className="relative min-w-[100px] flex-1">
          <Select value={sort.key} onValueChange={handleSortChange} disabled={isSortPending}>
            <SelectTrigger className="w-full min-w-[100px] max-w-[190px] h-9" aria-busy={isSortPending}>
              <SelectValue placeholder="Sort by..." className="text-base">
                {isSortPending ? (
                  <div className="flex items-center gap-2">
                    <Icon icon={Icons.spinner} className="animate-spin text-xl text-scale-900" />
                  </div>
                ) : (
                  SORT_OPTIONS.find((opt) => opt.value === sort.key)?.label
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="z-[50000]">
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value} className="text-base">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        {showShowLabel && (
          <span className="text-base text-scale-1100 whitespace-nowrap shrink-0">Show:</span>
        )}
        <div className="relative shrink-0">
          <Select value={countValue} onValueChange={handleCountChange} disabled={isCountPending}>
            <SelectTrigger className="min-w-[70px] w-[80px] sm:w-[90px] md:w-[100px] h-9" title="Show top N roads" aria-busy={isCountPending}>
              <SelectValue placeholder="Limit..." className="text-base">
                {isCountPending ? (
                  <div className="flex items-center gap-2">
                    <Icon icon={Icons.spinner} className="animate-spin text-xl text-scale-900" />
                  </div>
                ) : (
                  COUNT_OPTIONS.find((opt) => opt.value === countValue)?.label
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="z-[50000]">
              {COUNT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value} className="text-base">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {showSortOrderButtons && (
        <div className="flex items-center h-9 rounded-md border border-scale-600 bg-scale-100 overflow-hidden shrink-0 min-w-[70px] relative">
          <button
            onClick={() => handleSortOrderChange("asc")}
            disabled={isSortOrderPending}
            className={cn(
              "flex items-center justify-center h-full text-sm font-medium transition-colors",
              showSortOrderLabels ? "gap-1.5 px-2 sm:px-2.5" : "px-2",
              "border-r border-scale-600",
              sort.sortOrder === "asc"
                ? "bg-scale-1200 text-white"
                : "bg-scale-50 text-scale-1100 hover:bg-scale-200",
              isSortOrderPending && "opacity-50 cursor-not-allowed"
            )}
            title="Ascending"
            >
              <Icon icon="icon-[ph--arrow-up]" className="text-base" />
              {showSortOrderLabels && <span className="text-xs sm:text-sm">Asc</span>}
            </button>
            <button
              onClick={() => handleSortOrderChange("desc")}
              disabled={isSortOrderPending}
              className={cn(
                "flex items-center justify-center h-full text-sm font-medium transition-colors",
                showSortOrderLabels ? "gap-1.5 px-2 sm:px-2.5" : "px-2",
                sort.sortOrder === "desc"
                  ? "bg-scale-1200 text-white"
                  : "bg-scale-50 text-scale-1100 hover:bg-scale-200",
                isSortOrderPending && "opacity-50 cursor-not-allowed"
              )}
              title="Descending"
            >
              <Icon icon="icon-[ph--arrow-down]" className="text-base" />
              {showSortOrderLabels && <span className="text-xs sm:text-sm">Desc</span>}
            </button>
        </div>
      )}
    </div>
  )
}

