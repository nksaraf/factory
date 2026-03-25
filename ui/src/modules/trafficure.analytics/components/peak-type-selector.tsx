import { type PeakType } from "../data/use-roads-query"
import { cn } from "@rio.js/ui/lib/utils"

interface PeakTypeSelectorProps {
  value: PeakType
  onChange: (value: PeakType) => void
}

const PEAK_TYPE_OPTIONS: { value: PeakType; label: string }[] = [
  { value: "morning-peak", label: "Morning Peak" },
  { value: "evening-peak", label: "Evening Peak" },
  { value: "shoulder-hours", label: "Shoulder Hours" },
]

export function PeakTypeSelector({ value, onChange }: PeakTypeSelectorProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      {PEAK_TYPE_OPTIONS.map((option) => {
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

