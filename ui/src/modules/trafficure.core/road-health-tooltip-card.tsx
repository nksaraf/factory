import { motion } from "motion/react"
import React from "react"

import { Badge } from "@rio.js/ui/badge"
import { Button } from "@rio.js/ui/button"
import { Card, CardContent, CardFooter } from "@rio.js/ui/card"
import { Icon } from "@rio.js/ui/icon"
import { fromNow } from "@rio.js/ui/lib/fromnow"
import { cn } from "@rio.js/ui/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@rio.js/ui/tooltip"

import {
  type TrafficRoadProperties,
  formatLength,
  formatTime,
  getTrafficStatus,
} from "./traffic-utils"

type Pill = {
  text: string | React.ReactNode
  className?: string
  tooltip?: string | React.ReactNode
}

type ColorScheme = {
  border: string
  bg: string
  text: string
  hoverBorder: string
  hoverBg: string
  hoverText: string
}

// Helper function to build pill className with hover states
function buildPillClassName(colorScheme: ColorScheme): string {
  const hoverMap: Record<
    string,
    { hoverBorder: string; hoverBg: string; hoverText: string }
  > = {
    "border-red-300": {
      hoverBorder: "hover:border-red-400",
      hoverBg: "hover:bg-red-100",
      hoverText: "hover:text-red-800",
    },
    "border-orange-300": {
      hoverBorder: "hover:border-orange-400",
      hoverBg: "hover:bg-orange-100",
      hoverText: "hover:text-orange-800",
    },
    "border-yellow-300": {
      hoverBorder: "hover:border-yellow-400",
      hoverBg: "hover:bg-yellow-100",
      hoverText: "hover:text-yellow-800",
    },
    "border-green-300": {
      hoverBorder: "hover:border-green-400",
      hoverBg: "hover:bg-green-100",
      hoverText: "hover:text-green-800",
    },
    "border-gray-300": {
      hoverBorder: "hover:border-gray-400",
      hoverBg: "hover:bg-gray-100",
      hoverText: "hover:text-gray-800",
    },
  }

  const hoverClasses =
    hoverMap[colorScheme.border] || hoverMap["border-gray-300"]

  return cn(
    "border transition-colors",
    colorScheme.border,
    colorScheme.bg,
    colorScheme.text,
    hoverClasses.hoverBorder,
    hoverClasses.hoverBg,
    hoverClasses.hoverText
  )
}

// Generate speed pill
function generateSpeedPill(speedKmph: number): Pill | null {
  if (!speedKmph || speedKmph <= 0) {
    return null
  }

  const roundedSpeed = Math.round(speedKmph)
  let speedDescription: string
  let colorScheme: ColorScheme
  let tooltip: React.ReactNode

  if (speedKmph < 5) {
    speedDescription = "Very slow, near stand still"
    colorScheme = {
      border: "border-red-300",
      bg: "bg-red-50",
      text: "text-red-700",
      hoverBorder: "border-red-400",
      hoverBg: "bg-red-100",
      hoverText: "text-red-800",
    }
    tooltip = (
      <>
        Current speed is{" "}
        <strong>
          <span className="font-number tabular-nums">{roundedSpeed}</span>
        </strong>{" "}
        km/h, indicating traffic is nearly at a standstill. This is extremely
        slow - normal traffic flows at{" "}
        <strong>
          <span className="font-number tabular-nums">30-50</span>
        </strong>{" "}
        km/h. Vehicles are barely moving, suggesting a complete blockage or
        severe congestion ahead.
      </>
    )
  } else if (speedKmph < 10) {
    speedDescription = "Very slow"
    colorScheme = {
      border: "border-red-300",
      bg: "bg-red-50",
      text: "text-red-700",
      hoverBorder: "border-red-400",
      hoverBg: "bg-red-100",
      hoverText: "text-red-800",
    }
    tooltip = (
      <>
        Current speed is{" "}
        <strong>
          <span className="font-number tabular-nums">{roundedSpeed}</span>
        </strong>{" "}
        km/h, which is considered very slow traffic. Normal urban traffic
        typically flows at{" "}
        <strong>
          <span className="font-number tabular-nums">30-50</span>
        </strong>{" "}
        km/h.
      </>
    )
  } else if (speedKmph < 25) {
    speedDescription = "Slow"
    colorScheme = {
      border: "border-yellow-300",
      bg: "bg-yellow-50",
      text: "text-yellow-700",
      hoverBorder: "border-yellow-400",
      hoverBg: "bg-yellow-100",
      hoverText: "text-yellow-800",
    }
    tooltip = (
      <>
        Current speed is{" "}
        <strong>
          <span className="font-number tabular-nums">{roundedSpeed}</span>
        </strong>{" "}
        km/h, which is slower than normal urban traffic flow (typically{" "}
        <strong>
          <span className="font-number tabular-nums">30-50</span>
        </strong>{" "}
        km/h).
      </>
    )
  } else {
    speedDescription = "Normal"
    colorScheme = {
      border: "border-green-300",
      bg: "bg-green-50",
      text: "text-green-700",
      hoverBorder: "border-green-400",
      hoverBg: "bg-green-100",
      hoverText: "text-green-800",
    }
    tooltip = (
      <>
        Current speed is{" "}
        <strong>
          <span className="font-number tabular-nums">{roundedSpeed}</span>
        </strong>{" "}
        km/h, which is within normal traffic flow range.
      </>
    )
  }

  return {
    text: (
      <span>
        <span className="font-number tabular-nums">{roundedSpeed}</span> km/h -{" "}
        {speedDescription}
      </span>
    ),
    className: buildPillClassName(colorScheme),
    tooltip,
  }
}

// Generate baseline deviation pill
function generateBaselinePill(
  currentTime: number,
  baselineTime: number
): Pill | null {
  if (!baselineTime || baselineTime <= 0) {
    return null
  }

  const baselineDiff = currentTime - baselineTime
  const baselineDiffPercent = (baselineDiff / baselineTime) * 100
  const absPercent = Math.abs(baselineDiffPercent)

  let colorScheme: ColorScheme
  let text: string
  let tooltip: React.ReactNode

  if (absPercent < 5) {
    // Within 5% - typical for this hour
    colorScheme = {
      border: "border-green-300",
      bg: "bg-green-50",
      text: "text-green-700",
      hoverBorder: "border-green-400",
      hoverBg: "bg-green-100",
      hoverText: "text-green-800",
    }
    text = "Typical for this hour"
    tooltip = (
      <>
        Traffic is consistent with typical conditions at this time. Baseline
        travel time is{" "}
        <strong>
          <span className="font-number tabular-nums">
            {Math.round(baselineTime / 60)}
          </span>
        </strong>{" "}
        minutes, and current travel time is{" "}
        <strong>
          <span className="font-number tabular-nums">
            {Math.round(currentTime / 60)}
          </span>
        </strong>{" "}
        minutes.
      </>
    )
  } else if (baselineDiff > 0) {
    // Slower than baseline
    const delayMinutes = Math.round(baselineDiff / 60)
    if (absPercent < 20) {
      colorScheme = {
        border: "border-yellow-300",
        bg: "bg-yellow-50",
        text: "text-yellow-700",
        hoverBorder: "border-yellow-400",
        hoverBg: "bg-yellow-100",
        hoverText: "text-yellow-800",
      }
    } else {
      colorScheme = {
        border: "border-red-300",
        bg: "bg-red-50",
        text: "text-red-700",
        hoverBorder: "border-red-400",
        hoverBg: "bg-red-100",
        hoverText: "text-red-800",
      }
    }
    text = `+${delayMinutes}m vs usual`
    tooltip = (
      <>
        Traffic is{" "}
        <strong>
          <span className="font-number tabular-nums">{delayMinutes}</span>
        </strong>{" "}
        minutes slower than typical for this time ({" "}
        <strong>
          <span className="font-number tabular-nums">
            {Math.abs(baselineDiffPercent).toFixed(0)}
          </span>
          %
        </strong>{" "}
        above baseline). This suggests unusual congestion or an incident.
        Baseline travel time is{" "}
        <strong>
          <span className="font-number tabular-nums">
            {Math.round(baselineTime / 60)}
          </span>
        </strong>{" "}
        minutes.
      </>
    )
  } else {
    // Faster than baseline
    const speedupMinutes = Math.round(Math.abs(baselineDiff) / 60)
    colorScheme = {
      border: "border-green-300",
      bg: "bg-green-50",
      text: "text-green-700",
      hoverBorder: "border-green-400",
      hoverBg: "bg-green-100",
      hoverText: "text-green-800",
    }
    text = `-${speedupMinutes}m vs usual`
    tooltip = (
      <>
        Traffic is{" "}
        <strong>
          <span className="font-number tabular-nums">{speedupMinutes}</span>
        </strong>{" "}
        minutes faster than typical for this time ({" "}
        <strong>
          <span className="font-number tabular-nums">
            {Math.abs(baselineDiffPercent).toFixed(0)}
          </span>
          %
        </strong>{" "}
        below baseline). Traffic is flowing better than usual.
      </>
    )
  }

  return {
    text,
    className: buildPillClassName(colorScheme),
    tooltip,
  }
}

// Generate freeflow vs baseline context pill
function generateFreeflowBaselineContextPill(
  freeflowTime: number,
  baselineTime: number
): Pill | null {
  if (!baselineTime || baselineTime <= 0 || !freeflowTime) {
    return null
  }

  // If baseline is significantly higher than freeflow, this road is usually congested
  const baselineVsFreeflowRatio = baselineTime / freeflowTime
  if (baselineVsFreeflowRatio > 1.3) {
    return {
      text: "Usually congested at this hour",
      className: buildPillClassName({
        border: "border-gray-300",
        bg: "bg-gray-50",
        text: "text-gray-700",
        hoverBorder: "border-gray-400",
        hoverBg: "bg-gray-100",
        hoverText: "text-gray-800",
      }),
      tooltip: (
        <>
          This road segment typically experiences congestion at this time of
          day. Free flow travel time is{" "}
          <strong>
            <span className="font-number tabular-nums">
              {Math.round(freeflowTime / 60)}
            </span>
          </strong>{" "}
          minutes, but the baseline (typical) travel time is{" "}
          <strong>
            <span className="font-number tabular-nums">
              {Math.round(baselineTime / 60)}
            </span>
          </strong>{" "}
          minutes, indicating this is a regularly congested area.
        </>
      ),
    }
  }

  return null
}

// Generate freshness pill
function generateFreshnessPill(trafficEventTime: string): Pill | null {
  if (!trafficEventTime) {
    return null
  }

  try {
    const eventDate = new Date(trafficEventTime)
    const now = new Date()
    const diffMinutes = Math.floor(
      (now.getTime() - eventDate.getTime()) / 60000
    )

    let colorScheme: ColorScheme
    let text: string
    let tooltip: React.ReactNode

    if (diffMinutes < 5) {
      colorScheme = {
        border: "border-green-300",
        bg: "bg-green-50",
        text: "text-green-700",
        hoverBorder: "border-green-400",
        hoverBg: "bg-green-100",
        hoverText: "text-green-800",
      }
      text = "Updated just now"
    } else if (diffMinutes < 15) {
      colorScheme = {
        border: "border-green-300",
        bg: "bg-green-50",
        text: "text-green-700",
        hoverBorder: "border-green-400",
        hoverBg: "bg-green-100",
        hoverText: "text-green-800",
      }
      text = `Updated ${diffMinutes}m ago`
    } else if (diffMinutes < 30) {
      colorScheme = {
        border: "border-yellow-300",
        bg: "bg-yellow-50",
        text: "text-yellow-700",
        hoverBorder: "border-yellow-400",
        hoverBg: "bg-yellow-100",
        hoverText: "text-yellow-800",
      }
      text = `Updated ${diffMinutes}m ago`
    } else {
      colorScheme = {
        border: "border-red-300",
        bg: "bg-red-50",
        text: "text-red-700",
        hoverBorder: "border-red-400",
        hoverBg: "bg-red-100",
        hoverText: "text-red-800",
      }
      text = `Stale: ${diffMinutes}m ago`
    }

    tooltip = (
      <>
        Traffic data was last updated{" "}
        <strong>
          <span className="font-number tabular-nums">{diffMinutes}</span>
        </strong>{" "}
        minutes ago at{" "}
        <strong>
          {eventDate.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </strong>
        . {diffMinutes > 30 && "This data may be outdated."}
      </>
    )

    return {
      text,
      className: buildPillClassName(colorScheme),
      tooltip,
    }
  } catch {
    return null
  }
}

// Generate segment length pill
function generateSegmentLengthPill(lengthMeters: number): Pill | null {
  if (!lengthMeters || lengthMeters <= 0) {
    return null
  }

  const lengthKm = lengthMeters / 1000
  let description: string

  if (lengthKm < 0.1) {
    description = "Short segment"
  } else if (lengthKm < 0.5) {
    description = "Medium segment"
  } else {
    description = "Long segment"
  }

  return {
    text: `${formatLength(lengthMeters)} - ${description}`,
    className: buildPillClassName({
      border: "border-gray-300",
      bg: "bg-gray-50",
      text: "text-gray-700",
      hoverBorder: "border-gray-400",
      hoverBg: "bg-gray-100",
      hoverText: "text-gray-800",
    }),
    tooltip: (
      <>
        This road segment is{" "}
        <strong>
          <span className="font-number tabular-nums">
            {lengthKm < 1 ? lengthMeters.toFixed(0) : lengthKm.toFixed(2)}
          </span>{" "}
          {lengthKm < 1 ? "meters" : "kilometers"}
        </strong>{" "}
        long.{" "}
        {description === "Short segment" &&
          "Short segments may indicate a specific choke point or intersection."}
        {description === "Long segment" &&
          "Long segments represent a corridor or extended stretch of road."}
      </>
    ),
  }
}

// Generate all pills for a road segment
function generateRoadSegmentPills(
  properties: TrafficRoadProperties
): Array<Pill> {
  const pills: Array<Pill> = []
  const speed = parseFloat(properties.current_speed_kmph || "0")
  const currentTime = properties.current_travel_time_sec || 0
  const baselineTime = properties.baseline_travel_time_sec || 0
  const freeflowTime = properties.freeflow_travel_time_sec || 0

  // Speed pill
  const speedPill = generateSpeedPill(speed)
  if (speedPill) pills.push(speedPill)

  // Baseline deviation pill
  if (baselineTime > 0) {
    const baselinePill = generateBaselinePill(currentTime, baselineTime)
    if (baselinePill) pills.push(baselinePill)

    // Freeflow vs baseline context pill
    const contextPill = generateFreeflowBaselineContextPill(
      freeflowTime,
      baselineTime
    )
    if (contextPill) pills.push(contextPill)
  }

  //   // Freshness pill
  //   const freshnessPill = generateFreshnessPill(properties.traffic_event_time)
  //   if (freshnessPill) pills.push(freshnessPill)

  //   // Segment length pill
  //   const lengthPill = generateSegmentLengthPill(properties.road_length_meters)
  //   if (lengthPill) pills.push(lengthPill)

  return pills
}

interface RoadHealthTooltipCardProps {
  properties: TrafficRoadProperties
  className?: string
  renderSummarySection?: boolean
  renderButtons?: boolean
  onClose?: () => void
}

export function RoadHealthTooltipCard({
  properties,
  className,
  renderSummarySection = true,
  renderButtons = true,
  onClose,
}: RoadHealthTooltipCardProps) {
  const delayPercent = Number(properties.delay_percent || 0)
  const currentTime = properties.current_travel_time_sec || 0
  const freeflowTime = properties.freeflow_travel_time_sec || 0
  const baselineTime = properties.baseline_travel_time_sec || 0
  const delaySec = currentTime - freeflowTime

  // Get traffic status with all properties including header styles
  const statusInfo = getTrafficStatus(delayPercent)

  // Calculate bar widths (as percentages)
  const maxTime = Math.max(currentTime, freeflowTime) || 1
  const currentWidthPercent = (currentTime / maxTime) * 100
  const freeflowWidthPercent = (freeflowTime / maxTime) * 100

  // Calculate delay in minutes for display
  const delayMinutes = Math.round(delaySec / 60)

  // Generate narrative bullet points
  const getNarrativeBullets = () => {
    const bullets: Array<{ text: string; bold?: string }> = []

    // Current vs Freeflow comparison
    if (delaySec > 0) {
      const delayPercentFromFreeflow = (
        (delaySec / freeflowTime) *
        100
      ).toFixed(0)
      bullets.push({
        text: `Current travel time is ${formatTime(delaySec)} slower than free flow (${delayPercentFromFreeflow}% increase)`,
      })
    } else if (delaySec < 0) {
      const speedupPercent = (
        (Math.abs(delaySec) / freeflowTime) *
        100
      ).toFixed(0)
      bullets.push({
        text: `Current travel time is ${formatTime(Math.abs(delaySec))} faster than free flow (${speedupPercent}% improvement)`,
      })
    } else {
      bullets.push({
        text: "Current travel time matches free flow conditions",
      })
    }

    // Current vs Baseline comparison (if baseline is available)
    if (baselineTime > 0) {
      const baselineDiff = currentTime - baselineTime
      const baselineDiffPercent = (baselineDiff / baselineTime) * 100
      const baselineDiffPercentFormatted =
        Math.abs(baselineDiffPercent).toFixed(0)

      if (Math.abs(baselineDiffPercent) < 5) {
        // Within 5% of baseline - considered normal
        bullets.push({
          text: `Traffic is consistent with typical conditions at this time (baseline: ${formatTime(baselineTime)})`,
        })
      } else if (baselineDiff > 0) {
        // Slower than baseline
        bullets.push({
          text: `Traffic is ${formatTime(baselineDiff)} slower than typical for this time (${baselineDiffPercentFormatted}% above baseline of ${formatTime(baselineTime)})`,
          bold: `${formatTime(baselineDiff)} slower than typical`,
        })
      } else {
        // Faster than baseline
        bullets.push({
          text: `Traffic is ${formatTime(Math.abs(baselineDiff))} faster than typical for this time (${baselineDiffPercentFormatted}% below baseline of ${formatTime(baselineTime)})`,
          bold: `${formatTime(Math.abs(baselineDiff))} faster than typical`,
        })
      }
    }

    return bullets
  }

  //   // Render narrative bullets
  const renderNarrativeBullets = () => {
    const bullets = getNarrativeBullets()
    return (
      <ul className="list-disc list-inside space-y-1">
        {bullets.map((bullet, index) => {
          const parts = bullet.bold
            ? bullet.text.split(bullet.bold)
            : [bullet.text]

          return (
            <li key={index} className="text-xs text-slate-700 leading-relaxed">
              {bullet.bold ? (
                <>
                  {parts[0]}
                  <strong className="font-semibold">{bullet.bold}</strong>
                  {parts[1]}
                </>
              ) : (
                bullet.text
              )}
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <Card
      className={cn(
        "rounded-sm overflow-hidden shadow-sm w-[320px]",
        className
      )}
    >
      {/* Colored Header Section */}
      <div className={cn("px-3 py-2 rounded-t-sm", statusInfo.headerBg)}>
        <div className="flex items-center gap-2">
          <Icon
            icon={statusInfo.icon}
            className={cn("text-icon-md", statusInfo.headerTextColor)}
          />
          <span className={cn("text-sm font-bold", statusInfo.headerTextColor)}>
            {statusInfo.label}
          </span>
        </div>
      </div>

      <CardContent className="px-3 py-3 flex flex-col gap-3 bg-white">
        {/* Road Name and Delay */}
        <div className="flex flex-row gap-1 space-between">
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            <div className="text-md font-bold text-scale-1200 tracking-tight truncate">
              {properties.road_name || "Unknown Road"}
            </div>
            <div className="text-xs text-scale-1000">
              {formatLength(properties.road_length_meters)}
            </div>
          </div>
          <div className="flex flex-col items-end -space-y-1 ml-auto">
            <span
              className={cn("text-lg font-medium", statusInfo.headerTextColor)}
            >
              {delaySec > 0
                ? `+${delayMinutes}m`
                : delaySec < 0
                  ? `${delayMinutes}m`
                  : "0m"}
            </span>
            <span className={cn("text-xs", statusInfo.headerTextColor)}>
              Delay
            </span>
          </div>
        </div>

        {/* Travel Time Visualization */}
        <div className="pt-4 border-t border-slate-200 space-y-2">
          {/* Pill-style bar visualization */}
          <div className="relative">
            {/* Container with positioning context */}
            <div className="relative h-10 pt-4">
              {/* Free flow bar (broader background with prominent border) */}
              <div
                // className="absolute left-0 top-1/2 h-6 -translate-y-1/2 rounded-none border-2 border-slate-500 bg-slate-400"
                className="absolute left-0 top-1/2 h-6 -translate-y-1/2"
                // style={{ width: `${freeflowWidthPercent}%` }}
              >
                {/* Free flow label positioned above the bar */}
                <div className="absolute -top-4 left-1 text-[10px] font-medium text-slate-700 whitespace-nowrap">
                  Free flow: {formatTime(freeflowTime)}
                </div>
                {delaySec < 0 && (
                  <div className="absolute -top-4 right-1 text-[10px] font-medium text-slate-700 whitespace-nowrap">
                    <span className={cn("font-semibold", statusInfo.text)}>
                      {formatTime(Math.abs(delaySec))} faster
                    </span>
                  </div>
                )}
              </div>

              {/* Typical time (baseline) */}
              {baselineTime > 0 && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 text-[10px] font-medium text-slate-700 whitespace-nowrap">
                  Typical: {formatTime(baselineTime)}
                </div>
              )}

              {/* Current time bar (narrower filled bar on top) */}
              <div>
                {delaySec > 0 && (
                  <div className="absolute -top-[7px] right-1 text-[10px] font-medium text-slate-700 whitespace-nowrap">
                    <span className={cn("font-semibold", statusInfo.text)}>
                      +{formatTime(delaySec)} delayed
                    </span>
                  </div>
                )}
                {/* <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${currentWidthPercent}%` }}
                  transition={{
                    duration: 0.8,
                    ease: "easeOut",
                    delay: 0.2,
                  }}
                  className="absolute left-0 top-1/2 h-4 -translate-y-1/2 z-10 border-l-2 border-slate-500"
                >
                  <div className={cn("h-full rounded-none", statusInfo.bar)}>
                    <div className="absolute inset-0 -left-1 flex items-center px-2 text-[10px] font-semibold text-white whitespace-nowrap">
                      Current: {formatTime(currentTime)}
                    </div>
                  </div>
                </motion.div> */}
                <div className="absolute top-1/2 left-1 text-[10px] font-medium text-slate-700 whitespace-nowrap">
                  Current: {formatTime(currentTime)}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Pills Section */}
        <div className="pt-2 border-t border-slate-200">
          <div className="flex flex-wrap gap-2">
            {generateRoadSegmentPills(properties).map((pill, index) =>
              pill.tooltip ? (
                <Tooltip key={index}>
                  <TooltipTrigger asChild>
                    <Badge
                      className={cn(
                        "text-sm font-medium rounded-sm px-2.5 py-0.5 cursor-help",
                        pill.className ||
                          "bg-gray-100 text-gray-700 border border-gray-300"
                      )}
                    >
                      {pill.text}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    {typeof pill.tooltip === "string" ? (
                      <p className="text-base whitespace-normal">
                        {pill.tooltip}
                      </p>
                    ) : (
                      <div className="text-base whitespace-normal">
                        {pill.tooltip}
                      </div>
                    )}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Badge
                  key={index}
                  className={cn(
                    "text-sm font-medium rounded-sm px-2.5 py-0.5",
                    pill.className ||
                      "bg-gray-100 text-gray-700 border border-gray-300"
                  )}
                >
                  {pill.text}
                </Badge>
              )
            )}
          </div>
        </div>

        {/* Narrative Summary Section */}
        {/* {renderSummarySection && (
          <div className="pt-2 border-t border-slate-200">
            {renderNarrativeBullets()}
          </div>
        )} */}

        {/* Action Message Section */}
        {/* <div className="rounded bg-slate-50 px-2 py-2">
          <p
            className={cn(
              "text-sm font-semibold leading-relaxed flex items-center gap-1.5",
              statusInfo.text
            )}
          >
            <Icon icon={statusInfo.icon} className="text-sm" />
            {getVerdict()}
          </p>
        </div> */}

        {/* {Footer with last updated time and road length} */}
        <div className="text-xs flex flex-row justify-between text-slate-700">
          <div className="flex items-center gap-1">
            <Icon icon="icon-[ph--clock-duotone]" className="text-sm" />
            Last updated:{" "}
            {fromNow(new Date(properties.traffic_event_time), {
              addSuffix: true,
            })}
          </div>
          <div className="flex items-center gap-1">
            <Icon icon="icon-[tabler--ruler-3]" className="text-sm" />
            {formatLength(properties.road_length_meters)}
          </div>
        </div>
      </CardContent>

      {renderButtons && (
        <CardFooter className="p-0">
          <div className="flex items-center border-t w-full">
            <Button
              variant="outline"
              size="sm"
              icon="icon-[ph--archive-duotone]"
              className={cn(
                "border-0 rounded-none flex-1 text-wrap truncate text-yellow-600"
              )}
              onClick={(e) => {
                e.stopPropagation()
                // Handle dismiss action
                onClose?.()
              }}
            >
              Dismiss
            </Button>
            <div className="h-8 w-px bg-scale-400" />
            <Button
              icon="icon-[ph--user-sound-duotone]"
              variant="outline"
              size="sm"
              className={cn(
                "border-0 rounded-none flex-1 text-wrap truncate text-brand-600"
              )}
              onClick={(e) => {
                e.stopPropagation()
                // Handle escalate action
              }}
            >
              Escalate
            </Button>
          </div>
        </CardFooter>
      )}
    </Card>
  )
}
