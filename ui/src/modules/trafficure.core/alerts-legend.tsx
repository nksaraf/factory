import type { ReactNode } from "react"

import { ToolButton } from "@rio.js/gis-ui/components/tool-button"
import { cn } from "@rio.js/ui/lib/utils"

import {
  ALERT_TYPE_COLORS,
  ALERT_TYPE_DESCRIPTIONS,
  ALERT_TYPE_ICONS,
  ALERT_TYPE_LABELS,
  ALERT_TYPE_SEVERITY_ORDER,
  type AlertTypeKey,
} from "./alert-type-config"

interface AlertsLegendProps {
  /** When true, removes default styling to work inside a button group */
  grouped?: boolean
}

/**
 * Highlights numeric values and stats in description text with bolder text
 * Matches: percentages, ratios, speeds, times, distances, etc.
 * Excludes opening parenthesis '(' from highlighting
 */
function highlightStats(text: string): ReactNode[] {
  // Pattern to match numeric values: decimals, percentages, ratios, speeds, times, distances
  // Matches: 0.65, 65%, 90 sec/km, 2 consecutive cycles, 15%, 8 km/h, 6 minutes, etc.
  // Note: Opening parenthesis is excluded from the match
  const pattern =
    /(\d+\.?\d*\s*(?:consecutive\s+)?(?:cycles?|minutes?|sec\/km|km\/h)|0\.\d+|\d+%\)?|\d+%)/gi

  const parts: ReactNode[] = []
  let lastIndex = 0
  let match

  while ((match = pattern.exec(text)) !== null) {
    const matchStart = match.index

    // Add text before the match (including opening parenthesis if present)
    if (matchStart > lastIndex) {
      parts.push(text.slice(lastIndex, matchStart))
    }

    // Add highlighted match with bolder text (without opening parenthesis)
    parts.push(
      <span key={matchStart} className="font-bold">
        {match[0]}
      </span>
    )

    lastIndex = matchStart + match[0].length
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : [text]
}

export function AlertsLegend({ grouped = false }: AlertsLegendProps) {
  // Define the order of alert types by severity (most severe first)
  const alertTypes = (
    Object.keys(ALERT_TYPE_SEVERITY_ORDER) as AlertTypeKey[]
  ).sort((a, b) => ALERT_TYPE_SEVERITY_ORDER[a] - ALERT_TYPE_SEVERITY_ORDER[b])

  return (
    <ToolButton
      tooltip="Legend"
      variant={grouped ? undefined : "square"}
      className={
        grouped ? "bg-transparent border-0 rounded-none h-9 w-9" : undefined
      }
      dropdownMenu={
        <div className="-m-1 bg-white rounded-md">
          <div className="w-72 p-3">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-scale-600">
              <h3 className="font-semibold text-scale-1200">Legend</h3>
              <span className="icon-[ph--circles-four-duotone] text-lg text-scale-900" />
            </div>

            <div className="flex flex-col gap-4">
              {alertTypes.map((type) => {
                const label = ALERT_TYPE_LABELS[type]
                const description = ALERT_TYPE_DESCRIPTIONS[type]
                const icon = ALERT_TYPE_ICONS[type]
                const color = ALERT_TYPE_COLORS[type]?.text || "text-scale-700"

                return (
                  <div key={type} className="flex flex-col gap-2.5">
                    {/* Header row: label on left, icon on right */}
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm text-scale-1200">
                        {label}
                      </span>
                      <span className={cn("text-lg", icon, color)} />
                    </div>

                    {/* Conditions */}
                    <div className="text-xs text-scale-1000 leading-relaxed flex flex-col gap-1 pl-3">
                      {description.start.map((point, idx) => (
                        <span key={idx} className="flex items-start gap-1.5">
                          <span className="text-scale-500 mt-0.5">•</span>
                          <span>{highlightStats(point)}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      }
      icon="icon-[ph--circles-four-duotone]"
    />
  )
}
