import { useOptimistic, useTransition } from "react"

import { useItemsContext } from "@rio.js/app-ui/hooks/use-items-context"
import { Icon, Icons } from "@rio.js/ui/icon"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rio.js/ui/select"

export function ItemsSelectFilter({
  name: filter,
  label,
  options,
  defaultValue = "all",
  icon = Icons.check,
}: {
  name: string
  label: string
  options: string[] | { label: string; value: string }[]
  defaultValue?: string
  icon?: string
}) {
  const [isPending, transition] = useTransition()
  const { filters, setFilter } = useItemsContext()
  const currentValue = (filters[filter] as string | undefined) ?? defaultValue
  const triggerId = `select-${filter}`
  const [localValue, setLocalValue] = useOptimistic(currentValue)

  return (
    <div className="group relative">
      {/* <label
        htmlFor={triggerId}
        className="absolute start-1 top-0 z-10 block -translate-y-1/2 bg-background px-2 text-xs font-medium text-foreground group-has-[:disabled]:opacity-50"
      >
        <div className="flex gap-1 text-scale-1000">
          <span className={`${icon} mt-0.5 text-sm`} />
          {label}
        </div>
      </label> */}
      <Select
        value={localValue}
        onValueChange={(value) => {
          transition(() => {
            setLocalValue(value)
            setFilter(filter, value)
          })
        }}
      >
        <SelectTrigger
          id={triggerId}
          className="w-full sm:w-fit min-w-28 border-scale-700"
          size="sm_label"
        >
          <SelectValue placeholder={`Filter by ${filter}`} />
          {isPending ? <Icon icon={Icons.spinner}></Icon> : null}
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
