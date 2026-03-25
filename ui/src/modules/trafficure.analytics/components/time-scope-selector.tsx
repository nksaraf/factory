import { type TimeScope } from "../data/use-roads-query"
import { cn } from "@rio.js/ui/lib/utils"

interface TimeScopeSelectorProps {
  value: TimeScope
  onChange: (value: TimeScope) => void
}

const TIME_SCOPE_OPTIONS: { value: TimeScope; label: string }[] = [
  { value: "this_hour", label: "This Hour" },
  { value: "today", label: "Today" },
  { value: "this_week", label: "This Week" },
  { value: "this_month", label: "This Month" },
]

export function TimeScopeSelector({ value, onChange }: TimeScopeSelectorProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      {TIME_SCOPE_OPTIONS.map((option) => {
        const isSelected = value === option.value
        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-full transition-all flex-1",
              "border transition-colors",
              isSelected
                ? "bg-teal-600 text-white border-teal-600 shadow-sm"
                : "bg-scale-100 text-scale-1100 border-scale-400 hover:bg-scale-200 hover:border-teal-500/50"
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

