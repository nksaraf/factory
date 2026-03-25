import React, { forwardRef, useState } from "react"

import { useRio } from "@rio.js/client"
import { Badge } from "@rio.js/ui/badge"
import { Button } from "@rio.js/ui/button"
import { Card, CardContent } from "@rio.js/ui/card"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@rio.js/ui/dialog"
import { Icon } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"
import { Textarea } from "@rio.js/ui/textarea"

import { type Alert } from "./alerts-data"
import { 
  ALERT_TYPE_CONFIG,
  ALERT_TYPE_ICONS,
  ALERT_TYPE_LABELS,
  ALERT_TYPE_PILL_COLORS,
  ALERT_TYPE_TOOLTIPS,
  ALERT_TYPE_COLORS,
} from "./alert-type-config"

// Re-export for backward compatibility
const alertTypeConfig = ALERT_TYPE_CONFIG
import { useDismissAlert, useMarkGoodAlert } from "./data/use-alert-mutations"
import { formatInteger, formatDecimal, formatDelayWithPrefix } from "./utils/format-number"
import { getAlertDurationText } from "./utils/alert-duration"
import { formatTimeWithSmartDate } from "./utils/format-time"

interface AlertCardProps {
  alert: Alert
  isSelected?: boolean
  isHovered?: boolean
  isNew?: boolean
  onClick?: () => void
}

type Pill = {
  text: string | React.ReactNode
  isMain?: boolean
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
  // Map color scheme to full Tailwind classes with hover states
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
  }

  const hoverClasses =
    hoverMap[colorScheme.border] || hoverMap["border-red-300"]

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

// Helper function to generate speed pill
function generateSpeedPill(
  liveSpeedKmph: number | undefined,
  colorScheme: ColorScheme,
  contextMessage?: string
): Pill | null {
  if (liveSpeedKmph === undefined || liveSpeedKmph >= 10) {
    return null
  }

  const roundedSpeed = Math.round(liveSpeedKmph)
  let speedDescription = "Very slow"
  let tooltip: React.ReactNode = (
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
      {contextMessage && ` ${contextMessage}`}
    </>
  )

  if (liveSpeedKmph < 5) {
    speedDescription = "Very slow, near stand still"
    const defaultContext =
      contextMessage ||
      "Vehicles are barely moving, suggesting a complete blockage or severe congestion ahead."
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
        km/h. {defaultContext}
      </>
    )
  }

  return {
    text: (
      <span>
        <span className="font-number tabular-nums">
          {formatInteger(roundedSpeed)}
        </span>{" "}
        km/h - {speedDescription}
      </span>
    ),
    className: buildPillClassName(colorScheme),
    tooltip,
  }
}

// Helper function to generate deviation index pill
function generateDeviationPill(
  deviationIndex: number | undefined,
  currentTravelTimeSec: number,
  colorScheme: ColorScheme,
  threshold: number = 1.5
): Pill | null {
  if (deviationIndex === undefined || deviationIndex <= threshold) {
    return null
  }

  const roundedDeviation = Math.round(deviationIndex)
  const normalTravelTime = currentTravelTimeSec / deviationIndex / 60
  const currentTravelTime = currentTravelTimeSec / 60

  return {
    text: (
      <span>
        <span className="font-number tabular-nums">
          {formatInteger(roundedDeviation)}
        </span>
        x slower than usual
      </span>
    ),
    className: buildPillClassName(colorScheme),
    tooltip: (
      <>
        Travel time is{" "}
        <strong>
          <span className="font-number tabular-nums">{roundedDeviation}</span>
        </strong>{" "}
        times longer than normal free-flow conditions. This means a trip that
        typically takes{" "}
        <strong>
          <span className="font-number tabular-nums">
            {formatInteger(normalTravelTime)}
          </span>
        </strong>{" "}
        minutes is now taking{" "}
        <strong>
          <span className="font-number tabular-nums">
            {formatInteger(currentTravelTime)}
          </span>
        </strong>{" "}
        minutes. The deviation index of{" "}
        <strong>
          <span className="font-number tabular-nums">{roundedDeviation}</span>
        </strong>{" "}
        indicates that traffic volume has surged beyond normal capacity, causing
        significant delays.
      </>
    ),
  }
}

// Helper function to generate saturation index pill
function generateSaturationPill(
  saturationIndex: number | undefined,
  currentTravelTimeSec: number,
  colorScheme: ColorScheme,
  threshold: number,
  contextMessage?: string
): Pill | null {
  if (saturationIndex === undefined || saturationIndex <= threshold) {
    return null
  }

  const roundedSaturation = Math.round(saturationIndex)
  const normalTravelTime = Math.round(
    currentTravelTimeSec / saturationIndex / 60
  )
  const currentTravelTime = Math.round(currentTravelTimeSec / 60)
  const defaultContext =
    contextMessage ||
    "indicates that traffic volume has surged beyond normal capacity, causing significant delays."

  return {
    text: (
      <span>
        <span className="font-number tabular-nums">
          {formatInteger(roundedSaturation)}
        </span>
        x slower than free flow
      </span>
    ),
    className: buildPillClassName(colorScheme),
    tooltip: (
      <>
        Travel time is{" "}
        <strong>
          <span className="font-number tabular-nums">{roundedSaturation}</span>
        </strong>{" "}
        times longer than normal free-flow conditions. This means a trip that
        typically takes{" "}
        <strong>
          <span className="font-number tabular-nums">{normalTravelTime}</span>
        </strong>{" "}
        minutes is now taking{" "}
        <strong>
          <span className="font-number tabular-nums">{currentTravelTime}</span>
        </strong>{" "}
        minutes. The saturation index of{" "}
        <strong>
          <span className="font-number tabular-nums">{roundedSaturation}</span>
        </strong>{" "}
        {defaultContext}
      </>
    ),
  }
}

// Helper function to generate persistence pill
function generatePersistencePill(
  persistenceCount: number | undefined,
  colorScheme: ColorScheme,
  threshold: number = 15
): Pill | null {
  if (persistenceCount === undefined || persistenceCount <= threshold) {
    return null
  }

  const persistenceMinutes = Math.floor(persistenceCount * 2)
  const persistenceCountMinutes = Math.floor(persistenceCount)

  return {
    text: `Ongoing for >${persistenceMinutes} mins`,
    className: buildPillClassName(colorScheme),
    tooltip: (
      <>
        The alert has been stopped for more than{" "}
        <strong>
          <span className="font-number tabular-nums">
            {persistenceCountMinutes}
          </span>
        </strong>{" "}
        minutes.
      </>
    ),
  }
}

// Generate pills based on alert type and KPIs
export function generateAlertPills(alert: Alert): Array<Pill> {
  const pills: Array<Pill> = []
  const {
    alertType,
    persistenceCount,
    liveSpeedKmph,
    saturationIndex,
    currentTravelTimeSec,
    deviationIndex,
  } = alert
  const alertConfig = alertTypeConfig[alertType]

  // Use centralized color schemes
  const colors = ALERT_TYPE_PILL_COLORS[alertType] || ALERT_TYPE_PILL_COLORS.CONGESTION

  switch (alertType) {
    case "CONGESTION":
      // Main pill: "Traffic Congestion"
      pills.push({
        text: "Traffic Congestion",
        isMain: true,
        className: `${alertConfig.badgeBg} ${alertConfig.badgeTextColor} border-0`,
        tooltip: ALERT_TYPE_TOOLTIPS.CONGESTION,
      })

      // Speed pill
      const speedPill = generateSpeedPill(liveSpeedKmph, colors.speed)
      if (speedPill) pills.push(speedPill)

      // Deviation or saturation pill
      const deviationPill = generateDeviationPill(
        deviationIndex,
        currentTravelTimeSec,
        colors.factor
      )
      if (deviationPill) {
        pills.push(deviationPill)
      } else {
        const saturationPill = generateSaturationPill(
          saturationIndex,
          currentTravelTimeSec,
          colors.factor,
          2.0,
          "indicates severe congestion where traffic is moving at less than half the normal speed."
        )
        if (saturationPill) pills.push(saturationPill)
      }

      // Persistence pill
      const persistencePill = generatePersistencePill(
        persistenceCount,
        colors.persistence
      )
      if (persistencePill) pills.push(persistencePill)

      break

    case "RAPID_DETERIORATION":
      // Main pill using centralized label
      pills.push({
        text: ALERT_TYPE_LABELS.RAPID_DETERIORATION,
        isMain: true,
        className: `${alertConfig.badgeBg} ${alertConfig.badgeTextColor} border-0`,
        tooltip: ALERT_TYPE_TOOLTIPS.RAPID_DETERIORATION,
      })

      // Speed pill
      const speedPillRapid = generateSpeedPill(
        liveSpeedKmph,
        colors.speed,
        "The sudden drop in speed suggests an immediate obstruction or incident ahead."
      )
      if (speedPillRapid) pills.push(speedPillRapid)

      // Deviation or saturation pill
      const deviationPillRapid = generateDeviationPill(
        deviationIndex,
        currentTravelTimeSec,
        colors.factor
      )
      if (deviationPillRapid) {
        pills.push(deviationPillRapid)
      } else {
        const saturationPillRapid = generateSaturationPill(
          saturationIndex,
          currentTravelTimeSec,
          colors.factor,
          2.0,
          "indicates deterioration of traffic conditions, with vehicles moving at less than half the normal speed."
        )
        if (saturationPillRapid) pills.push(saturationPillRapid)
      }

      // Persistence pill
      const persistencePillRapid = generatePersistencePill(
        persistenceCount,
        colors.persistence
      )
      if (persistencePillRapid) pills.push(persistencePillRapid)

      break
  }

  return pills
}

export const AlertCard = forwardRef<HTMLDivElement, AlertCardProps>(
  ({ alert, isSelected = false, isHovered = false, isNew = false, onClick }, ref) => {
    const rio = useRio()

    const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false)
    const [feedbackType, setFeedbackType] = useState<"good" | "dismiss" | null>(
      null
    )
    const [feedbackText, setFeedbackText] = useState("")

    // Mutation hooks
    const dismissAlert = useDismissAlert()
    const markGoodAlert = useMarkGoodAlert()

    const isLoading = dismissAlert.isPending || markGoodAlert.isPending

    const handleMouseEnter = () => {
      rio.events.emit("alert.hover", {
        type: "alert",
        alertId: alert.id,
        alert,
      })
    }

    const handleMouseLeave = () => {
      rio.events.emit("alert.hover", {
        type: "alert",
        alertId: null,
        alert: null,
      })
    }

    const handleGoodAlertClick = (e: React.MouseEvent) => {
      e.stopPropagation()
      setFeedbackType("good")
      setIsFeedbackModalOpen(true)
    }

    const handleDismissClick = (e: React.MouseEvent) => {
      e.stopPropagation()
      setFeedbackType("dismiss")
      setIsFeedbackModalOpen(true)
    }

    const handleFeedbackSubmit = async () => {
      if (!feedbackType) return

      try {
        const alertId = parseInt(alert.id, 10)
        if (isNaN(alertId)) {
          console.error("Invalid alert ID:", alert.id)
          return
        }

        if (feedbackType === "dismiss") {
          await dismissAlert.mutateAsync({
            alertId,
            feedbackText: feedbackText.trim() || undefined,
          })
        } else if (feedbackType === "good") {
          await markGoodAlert.mutateAsync({
            alertId,
            feedbackText: feedbackText.trim() || undefined,
          })
        }

        // Close dialog on success
        setIsFeedbackModalOpen(false)
        setFeedbackText("")
        setFeedbackType(null)
      } catch (error) {
        console.error("Failed to submit feedback:", error)
        // Optionally show an error message to the user
      }
    }

    const handleFeedbackCancel = () => {
      setIsFeedbackModalOpen(false)
      setFeedbackText("")
      setFeedbackType(null)
    }

    // Calculate values for display
    const speed = alert.liveSpeedKmph || 0
    const slowdownFactor = alert.deviationIndex || alert.saturationIndex || 0

    // Use shared duration calculation utility
    const { durationText } = getAlertDurationText(alert)
    const isResolved = alert.type === "resolved" && alert.resolvedAt
    const isSuppressed = alert.type === "suppressed" && alert.resolvedAt
    const isHistorical = isResolved || isSuppressed

    // Get status tag text and styling based on alert type using centralized config
    const getStatusTag = () => {
      const colors = ALERT_TYPE_COLORS[alert.alertType]
      if (colors) {
        return {
          text: ALERT_TYPE_LABELS[alert.alertType],
          bg: colors.bgLight,
          textColor: colors.text,
        }
      }
      return {
        text: "Alert",
        bg: "bg-gray-100",
        textColor: "text-gray-800",
      }
    }

    const statusTag = getStatusTag()
    const alertTypeIcon = ALERT_TYPE_ICONS[alert.alertType]

    return (
      <>
        <style>{`
          @keyframes border-pulse {
            0%, 100% {
              box-shadow: 0 0 0 0 rgba(0, 0, 0, 0.8);
            }
            50% {
              box-shadow: 0 0 0 4px rgba(0, 0, 0, 0.4);
            }
          }
          .pulsing-border {
            animation: border-pulse 2s ease-in-out infinite;
          }
        `}</style>
        <Card
          ref={ref}
          className={cn(
            "rounded-lg group/card border border-scale-700 overflow-hidden cursor-pointer transition-shadow shadow-sm mb-2 hover:shadow-lg bg-scale-100",
            isSelected && "ring-2 ring-blue-500",
            isHovered &&
              !isSelected &&
              "ring-2 ring-yellow-400 bg-yellow-50/50 dark:bg-yellow-900/10",
            // Only apply pulsing animation when not hovered and not selected
            isNew && !isHovered && !isSelected && "pulsing-border"
          )}
          onClick={onClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <CardContent className="p-0 flex flex-col">
            {/* Top Section: Route and Delay */}
            <div className={cn(
              "px-4 flex items-start justify-between gap-4",
              isHistorical ? "py-2" : "py-3"
            )}>
              <div className="text-md font-medium text-scale-1200 tracking-tight flex-1 flex items-center gap-2">
                {alert.location}
                {isNew && (
                  <Badge variant="default" className="text-xs bg-blue-600 text-white">
                    NEW
                  </Badge>
                )}
              </div>
              {isHistorical ? (
                <div className="text-base font-medium text-green-700 shrink-0">
                  {durationText.replace("Went on for ", "Lasted ")}
                </div>
              ) : (
                <div className={cn(
                  "text-xl font-medium font-numbers tabular-nums shrink-0",
                  "text-red-600"
                )}>
                  {formatDelayWithPrefix(alert.impactCostSec)}
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="h-px bg-scale-500" />

            {/* Middle Section: Speed, Slowdown, Status - Hidden for resolved/suppressed alerts */}
            {!isHistorical && (
              <>
                <div className="px-4 flex items-center justify-between flex-wrap gap-1 min-h-9 py-2">
                  {/* Speed */}
                  <div className="flex items-center gap-2">
                    <Icon
                      icon="icon-[ph--gauge-duotone]"
                      className="text-icon-lg text-scale-1100 mt-0.5"
                    />
                    <span className="text-base font-numbers tabular-nums text-scale-1200">
                      {formatInteger(speed)} km/h
                    </span>
                  </div>

                  {/* Vertical Divider */}
                  <div className="self-stretch w-px bg-scale-500" />

                  {/* Slowdown Factor */}
                  <div className="flex items-center gap-2">
                    <Icon
                      icon="icon-[ph--trend-down-duotone]"
                      className="text-icon-sm text-[#E67300]"
                    />
                    <span className="text-base font-numbers tabular-nums text-amber-600">
                      {formatDecimal(slowdownFactor)}x Slower
                    </span>
                  </div>

                  {/* Vertical Divider */}
                  <div className="self-stretch w-px bg-scale-500" />

                  {/* Status Tag */}
                  <span
                    className={cn(
                      "flex items-center gap-1 text-base font-numbers font-medium tabular-nums",
                      statusTag.textColor
                    )}
                  >
                    {alertTypeIcon && (
                      <Icon icon={alertTypeIcon} className="text-icon-sm" />
                    )}
                    {statusTag.text}
                  </span>

                </div>

                {/* Divider */}
                <div className="h-px bg-scale-500" />
              </>
            )}

            {/* Bottom Section: Duration/Source and Actions */}
            <div className={cn(
              "px-4 flex items-center justify-between gap-4",
              isHistorical ? "py-2.5" : "py-2"
            )}>
              <div className="flex flex-col gap-0.5">
                <div className="text-base font-numbers text-scale-1000">
                  {isHistorical && alert.resolvedAt ? (
                    <>
                      {/* alert.startedAt = start time (from alert_event_time), alert.resolvedAt = end time (from timestamp for resolved) */}
                      {/* formatTimeWithSmartDate returns "N/A" if startedAt/resolvedAt is missing or invalid */}
                      {formatTimeWithSmartDate(alert.startedAt)} →{" "}
                      {formatTimeWithSmartDate(alert.resolvedAt)}
                    </>
                  ) : (
                    <>
                      {/* alert.startedAt = start time (from alert_event_time), no end time for active alerts */}
                      {/* formatTimeWithSmartDate returns "N/A" if startedAt is missing or invalid */}
                      {formatTimeWithSmartDate(alert.startedAt)} → Ongoing ({durationText.replace("Ongoing for ", "")})
                    </>
                  )}
                </div>
              </div>
              {!isHistorical && (
                <div className="flex items-center gap-1">
                  {/* <Button
                    onClick={onClick}
                    variant="ghost"
                    size="icon"
                    icon="icon-[ph--share-duotone]"
                  /> */}
                  <Button
                    onClick={handleGoodAlertClick}
                    variant="ghost"
                    size="icon"
                    icon="icon-[ph--thumbs-up-duotone]"
                  />
                  <Button
                    onClick={handleDismissClick}
                    variant="ghost"
                    size="icon"
                    icon="icon-[ph--x]"
                  />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Dialog
          open={isFeedbackModalOpen}
          onOpenChange={setIsFeedbackModalOpen}
        >
          <DialogContent className="max-w-2xl w-full">
            <DialogHeader>
              <DialogTitle>
                {feedbackType === "good"
                  ? "What did you like about this alert?"
                  : "Why are you dismissing this alert?"}
              </DialogTitle>
              <DialogDescription>
                Your feedback helps us improve our alert system.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Textarea
                placeholder="Share your thoughts..."
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                className="min-h-[100px]"
              />
            </DialogBody>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={handleFeedbackCancel}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button onClick={handleFeedbackSubmit} disabled={isLoading}>
                {isLoading ? "Submitting..." : "Submit Feedback"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    )
  }
)

AlertCard.displayName = "AlertCard"
