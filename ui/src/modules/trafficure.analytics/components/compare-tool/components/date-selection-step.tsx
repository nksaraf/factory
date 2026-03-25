import { useState, useMemo } from "react"
import { format, addDays, subDays, differenceInDays } from "date-fns"
import { Button } from "@rio.js/ui/button"
import { Calendar } from "@rio.js/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@rio.js/ui/popover"
import { Icon } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"

interface DateSelectionStepProps {
  beforeStartDate: Date | null
  beforeEndDate: Date | null
  afterStartDate: Date | null
  afterEndDate: Date | null
  onBeforeDateChange: (start: Date | null, end: Date | null) => void
  onAfterDateChange: (start: Date | null, end: Date | null) => void
}

export function DateSelectionStep({
  beforeStartDate,
  beforeEndDate,
  afterStartDate,
  afterEndDate,
  onBeforeDateChange,
  onAfterDateChange
}: DateSelectionStepProps) {
  const [beforeOpen, setBeforeOpen] = useState(false)
  const [afterOpen, setAfterOpen] = useState(false)

  const beforeDays = useMemo(() => {
    if (!beforeStartDate || !beforeEndDate) return 0
    return differenceInDays(beforeEndDate, beforeStartDate) + 1
  }, [beforeStartDate, beforeEndDate])

  const afterDays = useMemo(() => {
    if (!afterStartDate || !afterEndDate) return 0
    return differenceInDays(afterEndDate, afterStartDate) + 1
  }, [afterStartDate, afterEndDate])

  const isBeforeValid = beforeDays === 7
  const isAfterValid = afterDays === 7

  // Compute defaultMonth for before calendar: use selected date or today
  const beforeDefaultMonth = useMemo(() => {
    return beforeStartDate || new Date()
  }, [beforeStartDate])

  // Compute defaultMonth for after calendar: use selected date or today
  const afterDefaultMonth = useMemo(() => {
    return afterStartDate || new Date()
  }, [afterStartDate])

  const handleQuickSelect = (period: "before" | "after", type: "week" | "month" | "quarter") => {
    const today = new Date()
    let start: Date
    let end: Date

    if (type === "week") {
      end = subDays(today, 1)
      start = subDays(end, 6)
    } else if (type === "month") {
      end = subDays(today, 1)
      start = subDays(end, 29) // 30 days
    } else {
      // quarter
      end = subDays(today, 1)
      start = subDays(end, 89) // 90 days
    }

    if (period === "before") {
      onBeforeDateChange(start, end)
    } else {
      onAfterDateChange(start, end)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        {/* BEFORE Period */}
        <div className={cn(
          "flex-1 border-2 rounded-lg p-4 space-y-4 relative",
          isBeforeValid ? "border-blue-500 bg-blue-50" : "border-scale-600 bg-scale-200"
        )}>
          {isBeforeValid && (
            <div className="absolute top-2 right-2">
              <Icon icon="icon-[ph--check-circle]" className="text-blue-600 text-xl" />
            </div>
          )}
          <div className="font-semibold text-scale-1200">BEFORE PERIOD</div>
          
          <div className="space-y-3">
            <div>
              <label className="text-xs text-scale-1100 mb-1 block">Start Date</label>
              <Popover open={beforeOpen} onOpenChange={setBeforeOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !beforeStartDate && "text-scale-900"
                    )}
                  >
                    <span className="flex items-center gap-2">
                    <Icon icon="icon-[ph--calendar]" className="h-4 w-4" />
                    {beforeStartDate ? format(beforeStartDate, "MMM d, yyyy") : "Select start date"}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={beforeStartDate || undefined}
                    defaultMonth={beforeDefaultMonth}
                    onSelect={(date) => {
                      if (date) {
                        const end = addDays(date, 6)
                        onBeforeDateChange(date, end)
                        setBeforeOpen(false)
                      }
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div>
              <label className="text-xs text-scale-1100 mb-1 block">End Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !beforeEndDate && "text-scale-900"
                    )}
                    disabled
                  >
                    <span className="flex items-center gap-2">
                    <Icon icon="icon-[ph--calendar]" className="h-4 w-4" />
                    {beforeEndDate ? format(beforeEndDate, "MMM d, yyyy") : "Auto-calculated"}
                    </span>
                  </Button>
                </PopoverTrigger>
              </Popover>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleQuickSelect("before", "week")}
                className="text-xs"
              >
                Last Week
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleQuickSelect("before", "month")}
                className="text-xs"
              >
                Last Month
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleQuickSelect("before", "quarter")}
                className="text-xs"
              >
                Last Quarter
              </Button>
            </div>

            <div className="text-xs text-scale-1100">
              {beforeDays} {beforeDays === 1 ? "day" : "days"} selected
            </div>
          </div>
        </div>

        {/* VS Label */}
        <div className="text-lg font-bold text-scale-1100">VS</div>

        {/* AFTER Period */}
        <div className={cn(
          "flex-1 border-2 rounded-lg p-4 space-y-4 relative",
          isAfterValid ? "border-teal-500 bg-teal-50" : "border-scale-600 bg-scale-200"
        )}>
          {isAfterValid && (
            <div className="absolute top-2 right-2">
              <Icon icon="icon-[ph--check-circle]" className="text-teal-600 text-xl" />
            </div>
          )}
          <div className="font-semibold text-scale-1200">AFTER PERIOD</div>
          
          <div className="space-y-3">
            <div>
              <label className="text-xs text-scale-1100 mb-1 block">Start Date</label>
              <Popover open={afterOpen} onOpenChange={setAfterOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !afterStartDate && "text-scale-900"
                    )}
                  >
                    <span className="flex items-center gap-2">
                    <Icon icon="icon-[ph--calendar]" className="h-4 w-4" />
                    {afterStartDate ? format(afterStartDate, "MMM d, yyyy") : "Select start date"}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={afterStartDate || undefined}
                    defaultMonth={afterDefaultMonth}
                    onSelect={(date) => {
                      if (date) {
                        const end = addDays(date, 6)
                        onAfterDateChange(date, end)
                        setAfterOpen(false)
                      }
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div>
              <label className="text-xs text-scale-1100 mb-1 block">End Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !afterEndDate && "text-scale-900"
                    )}
                    disabled
                  >
                    <span className="flex items-center gap-2">
                    <Icon icon="icon-[ph--calendar]" className="h-4 w-4" />
                    {afterEndDate ? format(afterEndDate, "MMM d, yyyy") : "Auto-calculated"}
                    </span>
                  </Button>
                </PopoverTrigger>
              </Popover>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleQuickSelect("after", "week")}
                className="text-xs"
              >
                Last Week
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleQuickSelect("after", "month")}
                className="text-xs"
              >
                Last Month
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleQuickSelect("after", "quarter")}
                className="text-xs"
              >
                Last Quarter
              </Button>
            </div>

            <div className="text-xs text-scale-1100">
              {afterDays} {afterDays === 1 ? "day" : "days"} selected
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

