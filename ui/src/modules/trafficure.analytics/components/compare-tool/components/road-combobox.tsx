import { useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@rio.js/ui/button"
import { Command, CommandInput } from "@rio.js/ui/combobox"
import { Icon } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@rio.js/ui/popover"
import { useVirtualizer } from "@rio.js/ui/virtual"

interface RoadComboboxOption {
  value: string
  label: string
}

interface RoadComboboxProps {
  options: RoadComboboxOption[]
  value: string | null
  onValueChange: (value: string | null) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  className?: string
  disabled?: boolean
  loading?: boolean
}

export function RoadCombobox({
  options,
  value,
  onValueChange,
  placeholder = "Select a road...",
  searchPlaceholder = "Search roads...",
  emptyMessage = "No roads found",
  className,
  disabled = false,
  loading = false,
}: RoadComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const listRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find((opt) => opt.value === value)

  // Filter options based on search (cmdk does this automatically, but we need filtered list for virtualization)
  const filteredOptions = useMemo(() => {
    if (!search) return options
    return options.filter((option) =>
      option.label.toLowerCase().includes(search.toLowerCase())
    )
  }, [options, search])

  // Setup virtualization
  const virtualizer = useVirtualizer({
    count: filteredOptions.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 40,
    overscan: 10,
    // Enable smooth scrolling
    scrollPaddingStart: 0,
    scrollPaddingEnd: 0,
  })

  const virtualItems = virtualizer.getVirtualItems()

  // Reset search when closed and remeasure when opened
  useEffect(() => {
    if (!open) {
      setSearch("")
    } else {
      // Force remeasure when popover opens to show initial items
      requestAnimationFrame(() => {
        virtualizer.measure()
      })
    }
  }, [open, virtualizer])

  // Remeasure when options change
  useEffect(() => {
    if (open && filteredOptions.length > 0) {
      requestAnimationFrame(() => {
        virtualizer.measure()
      })
    }
  }, [filteredOptions.length, open, virtualizer])

  const handleSelect = (selectedValue: string) => {
    const newValue = selectedValue === value ? null : selectedValue
    setOpen(false)
    // Use setTimeout to allow popover to close before triggering parent re-render
    setTimeout(() => {
      onValueChange(newValue)
    }, 0)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between items-center relative pr-8 h-11 text-base",
            className
          )}
        >
          <span className="truncate flex-1 text-left pr-2 text-scale-1200">
            {loading
              ? "Loading roads..."
              : selectedOption
                ? selectedOption.label
                : placeholder}
          </span>
          <Icon
            icon="icon-[lucide--chevron-down]"
            className={cn(
              "h-4 w-4 shrink-0 opacity-50 transition-transform absolute right-2 text-scale-1200",
              open && "rotate-180"
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        sideOffset={1}
      >
        <Command shouldFilter={false} className="flex h-full flex-col">
          <div className="border-b border-scale-600">
            <CommandInput
              placeholder={searchPlaceholder}
              value={search}
              onValueChange={setSearch}
              className="!outline-none !ring-0 !border-0 focus:!outline-none focus:!ring-0 focus-visible:!ring-0 focus-visible:!ring-offset-0 [&_input]:!outline-none [&_input]:!ring-0 [&_input]:!border-0 [&_input]:focus:!outline-none [&_input]:focus:!ring-0 [&_input]:focus-visible:!ring-0"
              style={{ outline: "none", boxShadow: "none" }}
            />
          </div>
          <div
            ref={listRef}
            className="max-h-[300px] overflow-y-auto overflow-x-hidden"
            onWheel={(e) => {
              // Allow mouse wheel scrolling
              e.stopPropagation()
            }}
            onScroll={(e) => {
              // Ensure scroll events are captured
              e.stopPropagation()
            }}
          >
            {filteredOptions.length === 0 ? (
              <div className="py-6 text-center text-sm text-scale-1100">
                {emptyMessage}
              </div>
            ) : (
              <div
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  width: "100%",
                  position: "relative",
                }}
              >
                {virtualItems.map((virtualItem) => {
                  const option = filteredOptions[virtualItem.index]
                  const isSelected = option.value === value

                  return (
                    <div
                      key={option.value}
                      onClick={() => handleSelect(option.value)}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: `${virtualItem.size}px`,
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                      className={cn(
                        "relative flex cursor-pointer select-none items-center rounded-sm px-3 py-2.5 text-sm outline-none transition-colors hover:bg-scale-300 hover:text-scale-1200",
                        isSelected && "bg-scale-400 text-scale-1200"
                      )}
                    >
                      <span className="truncate">{option.label}</span>
                      {isSelected && (
                        <Icon
                          icon="icon-[lucide--check]"
                          className="ml-auto h-4 w-4 shrink-0"
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
