import { useState } from "react"

import { cn } from "@rio.js/ui/lib/utils"
import { Icon } from "@rio.js/ui/icon"

export function CopyCell({ value }: { value: string | null | undefined }) {
  const [copied, setCopied] = useState(false)
  if (!value) return <span className="text-muted-foreground">&mdash;</span>
  const copy = () => {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <span className="group inline-flex items-center gap-1">
      <span className="font-mono">{value}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          copy()
        }}
        title="Copy"
        className="opacity-0 group-hover:opacity-100 transition-opacity h-5 w-5 rounded hover:bg-accent flex items-center justify-center shrink-0"
      >
        <Icon
          icon={copied ? "icon-[ph--check-bold]" : "icon-[ph--copy-duotone]"}
          className={cn(
            "text-xs",
            copied ? "text-emerald-500" : "text-muted-foreground"
          )}
        />
      </button>
    </span>
  )
}
