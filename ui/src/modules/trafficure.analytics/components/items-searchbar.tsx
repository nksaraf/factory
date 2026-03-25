import { ChangeEvent, useEffect, useState, useTransition, useRef } from "react"
import { Input } from "@rio.js/ui/input"
import { Icon, Icons } from "@rio.js/ui/icon"

interface ItemsSearchbarProps {
  placeholder?: string
  value?: string
  onSearchChange?: (searchTerm: string) => void
}

export function ItemsSearchbar({
  placeholder = "Search roads",
  value,
  onSearchChange,
}: ItemsSearchbarProps) {
  const [inputValue, setInputValue] = useState(value || "")
  const [isPending, startTransition] = useTransition()
  const onSearchChangeRef = useRef(onSearchChange)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSentValueRef = useRef<string>(value || "")

  useEffect(() => {
    onSearchChangeRef.current = onSearchChange
  }, [onSearchChange])

  // Only sync value prop to inputValue if it's an external change
  // (not from our own debounced updates). The key is to avoid syncing when:
  // 1. User is actively typing (inputValue is ahead of value)
  // 2. The value prop matches what we just sent (our own update)
  useEffect(() => {
    if (value !== undefined && value !== inputValue) {
      // Don't sync if inputValue is longer than value - user is actively typing ahead
      if (inputValue.length > value.length) {
        return
      }
      
      // Don't sync if this is our own debounced update
      if (value === lastSentValueRef.current) {
        return
      }
      
      // Only sync for clear external changes:
      // 1. External clear (value is empty but inputValue is not)
      // 2. Significant external change (value is much shorter or different)
      const isExternalClear = value === "" && inputValue !== ""
      const isSignificantlyShorter = value.length < inputValue.length - 1
      
      if (isExternalClear || isSignificantlyShorter) {
        setInputValue(value)
      }
    }
  }, [value, inputValue])

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      startTransition(() => {
        onSearchChangeRef.current?.(inputValue)
        // Track what we sent so we can distinguish our updates from external changes
        lastSentValueRef.current = inputValue
      })
    }, 300)

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [inputValue])

  return (
    <div className="relative w-full" data-pending={isPending}>
      <Input
        placeholder={placeholder}
        icon={Icons.search as any}
        value={inputValue}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setInputValue(event.target.value)
        }}
        className="w-full"
        style={{ paddingRight: "2.5rem" }}
        {...(isPending && { "aria-busy": true })}
      />
      {isPending && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-scale-900">
          <Icon icon={Icons.spinner} className="animate-spin" />
        </span>
      )}
    </div>
  )
}

