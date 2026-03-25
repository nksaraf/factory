import React, { ChangeEvent, useEffect, useMemo, useState, useTransition } from "react"
import { useLocation, useNavigate } from "react-router"

import { Badge } from "@rio.js/ui/badge"
import { Button } from "@rio.js/ui/button"
import { Card, CardContent } from "@rio.js/ui/card"
import { Icon, Icons } from "@rio.js/ui/icon"
import { Input } from "@rio.js/ui/input"
import { cn } from "@rio.js/ui/lib/utils"

import {
  type Alert,
} from "./alerts-data"
import { 
  ALERT_TYPE_CONFIG,
  ALERT_TYPE_SEVERITY_ORDER,
} from "./alert-type-config"
import { formatDecimal } from "./utils/format-number"
import { useAlertsQuery } from "./data/alerts"

const severityColors = {
  high: "destructive",
  medium: "default",
  low: "secondary",
} as const

const typeColors = {
  crash: "destructive",
  closure: "default",
  congestion: "secondary",
  breakdown: "default",
} as const

// Use centralized config with uppercase labels for mobile
export const alertTypeConfig = {
  CONGESTION: {
    ...ALERT_TYPE_CONFIG.CONGESTION,
    label: ALERT_TYPE_CONFIG.CONGESTION.labelUpper,
    headerBg: "bg-orange-500",
  },
  RAPID_DETERIORATION: {
    ...ALERT_TYPE_CONFIG.RAPID_DETERIORATION,
    label: ALERT_TYPE_CONFIG.RAPID_DETERIORATION.labelUpper,
    headerBg: "bg-red-600",
  },
} as const

// Simple mini-graph component (kept for detail view)
export function MiniGraph({
  data,
  height = 35,
  width = 160,
  color = "red",
}: {
  data: number[]
  color?: string
  height?: number
  width?: number
}) {
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1

  const colorClass =
    {
      red: "stroke-red-500",
      orange: "stroke-orange-500",
      yellow: "stroke-yellow-500",
    }[color] || "stroke-red-500"

  const fillColorClass =
    {
      red: "fill-red-500/20",
      orange: "fill-orange-500/20",
      yellow: "fill-yellow-500/20",
    }[color] || "fill-red-500/20"

  // Normalize data to 0-1 range
  const normalized = data.map((v) => (v - min) / range)
  const padding = 2

  const points = normalized
    .map((val, i) => {
      const x =
        padding + (i / (normalized.length - 1 || 1)) * (width - padding * 2)
      const y = padding + (1 - val) * (height - padding * 2)
      return `${x},${y}`
    })
    .join(" ")

  const areaPoints = `M${padding},${height - padding} L${points.split(" ").join(" L")} L${
    width - padding
  },${height - padding} Z`

  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={areaPoints} className={fillColorClass} stroke="none" />
      <polyline
        points={points}
        fill="none"
        strokeWidth="1.5"
        className={colorClass}
      />
    </svg>
  )
}

// Ghost Bar visualization component
// Shows historical median time (grey) vs current travel time (colored)
export function GhostBar({
  historicalMedianTime,
  currentTravelTime,
  color = "red",
  width = 160,
  height = 20,
}: {
  historicalMedianTime: number // seconds
  currentTravelTime: number // seconds
  color?: string
  width?: number
  height?: number
}) {
  // Grey bar represents historical median (fixed at 30% width)
  const greyBarWidth = width * 0.3
  // Colored bar scales relative to grey bar
  const ratio = currentTravelTime / historicalMedianTime
  const coloredBarWidth = Math.min(greyBarWidth * ratio, width)

  const colorClass =
    {
      red: "bg-red-500",
      orange: "bg-orange-500",
      yellow: "bg-yellow-500",
    }[color] || "bg-red-500"

  return (
    <div className="flex flex-col gap-1" style={{ width }}>
      {/* Grey bar (historical median) */}
      <div
        className="bg-scale-400 rounded-sm"
        style={{ width: greyBarWidth, height }}
      />
      {/* Colored bar (current travel time) */}
      <div
        className={cn("rounded-sm", colorClass)}
        style={{ width: coloredBarWidth, height }}
      />
    </div>
  )
}

// Generate dynamic status text based on alert type and metrics
export function getDynamicStatusText(alert: Alert): string {
  const {
    alertType,
    persistence,
    currentSpeed,
    saturationIndex,
    roadLength,
  } = alert

  let statusText = ""

  switch (alertType) {
    case "CONGESTION":
      const persistenceText =
        persistence && persistence > 15
          ? `STOPPED >${Math.floor(persistence)} MINS`
          : persistence && persistence >= 8
            ? `STOPPED ${Math.floor(persistence)}+ MINS`
            : currentSpeed && currentSpeed < 5
              ? "STOPPED"
              : "TRAFFIC HALTED"

      // Use saturationIndex as a proxy for queue/backup, or roadLength if available
      const queueText = saturationIndex
        ? `SATURATION ${formatDecimal(saturationIndex)}x`
        : roadLength
          ? `QUEUE +${formatDecimal(roadLength * 0.621371 / 1000)} MILES`
          : "QUEUE FORMING"

      statusText = `${persistenceText} • ${queueText}`
      break

    case "RAPID_DETERIORATION":
      const speedText =
        currentSpeed !== undefined && currentSpeed === 0
          ? "0 MPH FLOW"
          : currentSpeed && currentSpeed < 5
            ? `${Math.floor(currentSpeed)} MPH FLOW`
            : "SLOW FLOW"

      statusText = `RAPID SLOWDOWN • ${speedText}`
      break

    default:
      statusText = "TRAFFIC ALERT"
  }

  return statusText
}

// Memoized mobile alert card component to prevent unnecessary re-renders
const MobileAlertCard = React.memo(({
  alert,
  isSelected,
  onNavigate,
}: {
  alert: Alert
  isSelected: boolean
  onNavigate: () => void
}) => {
  const alertConfig = alertTypeConfig[alert.alertType]

  // Memoize expensive calculations
  const distance = useMemo(() => {
    // Use roadLength if available (convert meters to miles)
    if (alert.roadLength) {
      return `${formatDecimal(alert.roadLength * 0.621371 / 1000)} mi away`
    }
    return ""
  }, [alert.roadLength])

  // Memoize status text calculation - only recalculate when relevant fields change
  const statusText = useMemo(() => getDynamicStatusText(alert), [
    alert.alertType,
    alert.persistence,
    alert.currentSpeed,
    alert.saturationIndex,
    alert.roadLength,
  ])
  const impactMinutes = useMemo(() => formatDecimal(alert.impactMinutes || 0), [alert.impactMinutes])

  return (
    <Card
      className={cn(
        "rounded-lg overflow-hidden transition-colors shadow-sm mb-2",
        isSelected && "ring-2 ring-blue-500"
      )}
      onClick={onNavigate}
    >
      {/* Colored Header Section */}
      <div
        className={cn("px-4 py-2 rounded-t-lg", alertConfig.headerBg)}
      >
        <div className="flex items-center gap-2">
          <Icon
            icon={alertConfig.icon}
            className={cn("text-icon-md", alertConfig.headerTextColor)}
          />
          <span
            className={cn(
              "text-sm font-bold uppercase",
              alertConfig.headerTextColor
            )}
          >
            {alertConfig.label}
          </span>
        </div>
      </div>

      <CardContent className="px-4 py-3 flex flex-col gap-3 bg-white">
        {/* Road Name */}
        <div className="flex flex-col gap-1">
          <div className="text-lg font-bold text-scale-1200 uppercase tracking-tight">
            {alert.location}
          </div>
          {alert.landmark && (
            <div className="text-xs text-scale-1000">
              {alert.landmark}
              {distance && ` • ${distance}`}
            </div>
          )}
        </div>

        {/* Delay Badge */}
        <div className="flex justify-center">
          <div
            className={cn(
              "px-4 py-1.5 rounded-full",
              alertConfig.badgeBg,
              alertConfig.badgeTextColor
            )}
          >
            <span className="text-sm font-bold uppercase">
              +{impactMinutes}m DELAY
            </span>
          </div>
        </div>

        {/* Status Text */}
        <div className="text-sm font-medium text-scale-1100 uppercase tracking-wide">
          {statusText}
        </div>
      </CardContent>
    </Card>
  )
})

MobileAlertCard.displayName = "MobileAlertCard"

function ItemsSearchbar({
  placeholder: placeholder = "Search",
}: {
  placeholder?: string
}) {
  const searchTerm = ""
  const [inputValue, setInputValue] = useState("")
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setInputValue(searchTerm)
  }, [searchTerm])

  //   useEffect(() => {
  //     const handler = window.setTimeout(() => {
  //       const normalizedFilterValue = filters.searchTerm ?? ""
  //       const normalizedInputValue = inputValue ?? ""
  //       if (normalizedFilterValue === normalizedInputValue) return
  //       startTransition(() => {
  //         setFilter("searchTerm", normalizedInputValue || null)
  //       })
  //     }, 300)

  //     return () => {
  //       window.clearTimeout(handler)
  //     }
  //   }, [filters.searchTerm, inputValue, setFilter, startTransition])

  return (
    <div className="relative md:max-w-sm md:flex-1" data-pending={isPending}>
      <Input
        placeholder={placeholder}
        icon={Icons.search}
        value={inputValue}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const value = event.target.value
          setInputValue(value)
        }}
        className="w-full md:flex-1"
        style={{ paddingRight: "2.5rem" }}
        aria-busy={isPending}
      />
      {isPending ? (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-scale-900">
          <Icon icon={Icons.spinner} className="animate-spin" />
        </span>
      ) : null}
    </div>
  )
}

export function AlertsInboxMobile() {
  const navigate = useNavigate()
  const location = useLocation()
  const selectedAlertId = location.pathname.split("/").pop()

  // Use optimized alerts query hook (same as desktop and map)
  // This hook handles caching, transformation, filtering, and sorting efficiently
  const { alerts: fetchedAlerts } = useAlertsQuery(
    {}, // No filters for mobile
    { key: "delay_seconds", sortOrder: "desc" }, // Default sort
    null // No count limit
  )

  // Memoize sorted alerts to avoid re-sorting on every render
  const sortedAlerts = useMemo(() => {
    if (!fetchedAlerts || fetchedAlerts.length === 0) {
      return []
    }
    
    return [...fetchedAlerts].sort((a, b) => {
      if (ALERT_TYPE_SEVERITY_ORDER[a.alertType] !== ALERT_TYPE_SEVERITY_ORDER[b.alertType]) {
        return ALERT_TYPE_SEVERITY_ORDER[a.alertType] - ALERT_TYPE_SEVERITY_ORDER[b.alertType]
      }
      const severityOrder = { EMERGENCY: 0, WARNING: 1 }
      if (severityOrder[a.severity] !== severityOrder[b.severity]) {
        return severityOrder[a.severity] - severityOrder[b.severity]
      }
      return (b.impactMinutes || 0) - (a.impactMinutes || 0)
    })
  }, [fetchedAlerts])

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="px-3 py-2 border-b bg-background flex flex-row gap-2 items-center">
        <ItemsSearchbar />
        <Icon icon="icon-[ph--funnel-duotone] text-scale-1100" />
        <Icon icon="icon-[hugeicons--calendar-03] text-scale-1100" />
      </div>
      <div className="flex-1 overflow-y-auto pretty-scroll">
        {sortedAlerts.map((alert) => {
          return (
            <MobileAlertCard
              key={alert.id}
              alert={alert}
              isSelected={selectedAlertId === alert.id}
              onNavigate={() => navigate(`/alerts/${alert.id}`)}
            />
          )
        })}
      </div>
    </div>
  )
}
