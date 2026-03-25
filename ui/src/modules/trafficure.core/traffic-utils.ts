// Helper functions for traffic layer
import { bearing, destination, lineString, point } from "@rio.js/geo"

export interface TrafficRoadProperties {
  traffic_status: string
  current_speed_kmph: string
  delay_percent: string
  /** The actual time when this traffic data was measured (use for all temporal operations) */
  traffic_event_time: string
  road_id: string
  road_name: string
  layerName: string
  road_length_meters: number
  current_travel_time_sec: number
  freeflow_travel_time_sec: number
  baseline_travel_time_sec?: number
  /** Delay in seconds from API/query (use for map highlight so it matches inbox) */
  delay_seconds?: number
  /** Delay in minutes from API/query (delay_minutes * 60 used when delay_seconds not set) */
  delay_minutes?: number
}

/**
 * Get delay in seconds for coloring. Prefers API/query values so map highlight matches road inbox.
 * Falls back to computed (current_travel_time_sec - baseline/freeflow) when not available.
 */
export function getDelaySecondsForColor(properties: TrafficRoadProperties): number {
  if (properties.delay_seconds != null && !Number.isNaN(properties.delay_seconds)) {
    return properties.delay_seconds
  }
  if (properties.delay_minutes != null && !Number.isNaN(properties.delay_minutes)) {
    return properties.delay_minutes * 60
  }
  const current = properties.current_travel_time_sec ?? 0
  const reference =
    properties.baseline_travel_time_sec ??
    properties.freeflow_travel_time_sec ??
    0
  return current - reference
}

// Traffic status function based on delay seconds (absolute time impact)
// Thresholds: >270s (dark red), >180s (red), >90s (orange-red), >30s (orange), >0s (yellow), <=0s (green)
export function getTrafficStatusBySeconds(delaySeconds: number) {
  // Dark Red: Extreme delay (>4.5 minutes delay)
  if (delaySeconds > 270) {
    return {
      color: [139, 26, 26, 255] as [number, number, number, number],
      borderColor: [180, 50, 50, 180] as [number, number, number, number],
      label: "Stopped traffic",
      colorName: "darkred" as const,
      bg: "bg-red-900",
      bar: "bg-red-900",
      text: "text-red-900",
      icon: "icon-[ph--traffic-sign-duotone]",
      headerBg: "bg-red-100",
      headerTextColor: "text-red-900",
      badgeBg: "bg-red-900",
      badgeTextColor: "text-white",
    }
  }
  // Red: Severe delay (3-5 minutes delay)
  else if (delaySeconds > 180) {
    return {
      color: [215, 47, 47, 255] as [number, number, number, number],
      borderColor: [240, 80, 80, 180] as [number, number, number, number],
      label: "Severe congestion",
      colorName: "red" as const,
      bg: "bg-red-600",
      bar: "bg-red-600",
      text: "text-red-600",
      icon: "icon-[ph--traffic-sign-duotone]",
      headerBg: "bg-red-100",
      headerTextColor: "text-red-700",
      badgeBg: "bg-red-600",
      badgeTextColor: "text-white",
    }
  }
  // Orange-Red: Heavy delay (1.5-3 minutes delay)
  else if (delaySeconds > 90) {
    return {
      color: [245, 124, 0, 255] as [number, number, number, number],
      borderColor: [255, 150, 40, 180] as [number, number, number, number],
      label: "Heavy traffic",
      colorName: "orangered" as const,
      bg: "bg-orange-600",
      bar: "bg-orange-600",
      text: "text-orange-600",
      icon: "icon-[ph--warning-circle-duotone]",
      headerBg: "bg-orange-100",
      headerTextColor: "text-orange-700",
      badgeBg: "bg-orange-600",
      badgeTextColor: "text-white",
    }
  }
  // Orange: Moderate delay (30s-1.5 minutes delay)
  else if (delaySeconds > 30) {
    return {
      color: [255, 179, 0, 255] as [number, number, number, number],
      borderColor: [255, 200, 50, 180] as [number, number, number, number],
      label: "Moderate-heavy traffic",
      colorName: "orange" as const,
      bg: "bg-orange-500",
      bar: "bg-orange-500",
      text: "text-orange-500",
      icon: "icon-[ph--warning-duotone]",
      headerBg: "bg-orange-100",
      headerTextColor: "text-orange-700",
      badgeBg: "bg-orange-500",
      badgeTextColor: "text-white",
    }
  }
  // Yellow: Light delay (0-30 seconds delay)
  else if (delaySeconds > 0) {
    return {
      color: [255, 205, 0, 255] as [number, number, number, number],
      borderColor: [255, 220, 40, 180] as [number, number, number, number],
      label: "Light traffic",
      colorName: "yellow" as const,
      bg: "bg-yellow-500",
      bar: "bg-yellow-500",
      text: "text-yellow-600",
      icon: "icon-[ph--info-duotone]",
      headerBg: "bg-yellow-100",
      headerTextColor: "text-yellow-700",
      badgeBg: "bg-yellow-500",
      badgeTextColor: "text-white",
    }
  }
  // Green: No delay or negative delay
  else {
    return {
      color: [48, 179, 45, 255] as [number, number, number, number],
      borderColor: [80, 200, 77, 180] as [number, number, number, number],
      label: "Free flow",
      colorName: "green" as const,
      bg: "bg-green-500",
      bar: "bg-green-500",
      text: "text-green-600",
      icon: "icon-[ph--check-circle-duotone]",
      headerBg: "bg-green-100",
      headerTextColor: "text-green-700",
      badgeBg: "bg-green-500",
      badgeTextColor: "text-white",
    }
  }
}

// Unified traffic status function - single source of truth for all traffic status logic
// Based on Google Maps color scheme with granular thresholds:
// >100% (dark red), >50% (red), >25% (orange-red), >10% (orange), >0% (yellow), <=0% (green)
export function getTrafficStatus(delayPercent: number) {
  // Dark Red: Stopped/parking lot traffic (>100% delay)
  if (delayPercent > 100) {
    return {
      // RGB color for map rendering - Google's dark red
      color: [139, 26, 26, 255] as [number, number, number, number],
      // Border color (slightly lighter)
      borderColor: [180, 50, 50, 180] as [number, number, number, number],
      // UI properties
      label: "Stopped traffic",
      colorName: "darkred" as const,
      bg: "bg-red-900",
      bar: "bg-red-900",
      text: "text-red-900",
      icon: "icon-[ph--traffic-sign-duotone]",
      // Legacy config for old components
      headerBg: "bg-red-100",
      headerTextColor: "text-red-900",
      badgeBg: "bg-red-900",
      badgeTextColor: "text-white",
    }
  }
  // Red: Severe congestion (50-100% delay)
  else if (delayPercent > 50) {
    return {
      // RGB color for map rendering - Google's red
      color: [215, 47, 47, 255] as [number, number, number, number],
      // Border color (lighter shade)
      borderColor: [240, 80, 80, 180] as [number, number, number, number],
      // UI properties
      label: "Severe congestion",
      colorName: "red" as const,
      bg: "bg-red-600",
      bar: "bg-red-600",
      text: "text-red-600",
      icon: "icon-[ph--traffic-sign-duotone]",
      // Legacy config for old components
      headerBg: "bg-red-100",
      headerTextColor: "text-red-700",
      badgeBg: "bg-red-600",
      badgeTextColor: "text-white",
    }
  }
  // Orange-Red: Heavy traffic (25-50% delay)
  else if (delayPercent > 25) {
    return {
      // RGB color for map rendering - Google's orange-red
      color: [245, 124, 0, 255] as [number, number, number, number],
      borderColor: [255, 150, 40, 180] as [number, number, number, number],
      label: "Heavy traffic",
      colorName: "orangered" as const,
      bg: "bg-orange-600",
      bar: "bg-orange-600",
      text: "text-orange-600",
      icon: "icon-[ph--warning-circle-duotone]",
      headerBg: "bg-orange-100",
      headerTextColor: "text-orange-700",
      badgeBg: "bg-orange-600",
      badgeTextColor: "text-white",
    }
  }
  // Orange: Moderate-heavy traffic (10-25% delay)
  else if (delayPercent > 10) {
    return {
      // RGB color for map rendering - Google's orange
      color: [255, 179, 0, 255] as [number, number, number, number],
      borderColor: [255, 200, 50, 180] as [number, number, number, number],
      label: "Moderate-heavy traffic",
      colorName: "orange" as const,
      bg: "bg-orange-500",
      bar: "bg-orange-500",
      text: "text-orange-500",
      icon: "icon-[ph--warning-duotone]",
      headerBg: "bg-orange-100",
      headerTextColor: "text-orange-700",
      badgeBg: "bg-orange-500",
      badgeTextColor: "text-white",
    }
  }
  // Yellow: Light-moderate traffic (0-10% delay)
  else if (delayPercent > 0) {
    return {
      color: [255, 205, 0, 255] as [number, number, number, number],
      borderColor: [255, 220, 40, 180] as [number, number, number, number],
      label: "Light traffic",
      colorName: "yellow" as const,
      bg: "bg-yellow-500",
      bar: "bg-yellow-500",
      text: "text-yellow-600",
      icon: "icon-[ph--info-duotone]",
      headerBg: "bg-yellow-100",
      headerTextColor: "text-yellow-700",
      badgeBg: "bg-yellow-500",
      badgeTextColor: "text-white",
    }
  }
  // Green: Free flow (<=0% delay)
  else {
    return {
      // RGB color for map rendering - Google's green
      color: [48, 179, 45, 255] as [number, number, number, number],
      borderColor: [80, 200, 77, 180] as [number, number, number, number],
      label: "Free flow",
      colorName: "green" as const,
      bg: "bg-green-500",
      bar: "bg-green-500",
      text: "text-green-600",
      icon: "icon-[ph--check-circle-duotone]",
      headerBg: "bg-green-100",
      headerTextColor: "text-green-700",
      badgeBg: "bg-green-500",
      badgeTextColor: "text-white",
    }
  }
}

function isLightBaseMapStyle(mapStyle?: string) {
  // Keep this intentionally conservative: only styles explicitly labeled "light"
  // get the higher-contrast (darker) green + gray highlight borders.
  return Boolean(mapStyle && mapStyle.toLowerCase().includes("light"))
}

// Convenience functions that extract specific properties from getTrafficStatusBySeconds
export function getTrafficColorBySeconds(
  delaySeconds: number,
  mapStyle?: string
): [number, number, number, number] {
  const status = getTrafficStatusBySeconds(delaySeconds)

  // Only adjust the "green" map rendering color for light base maps.
  if (status.colorName === "green" && isLightBaseMapStyle(mapStyle)) {
    return [0, 160, 0, 255]
  }

  return status.color
}

export function getTrafficBorderColorBySeconds(
  delaySeconds: number,
  mapStyle?: string
): [number, number, number, number] {
  const status = getTrafficStatusBySeconds(delaySeconds)

  // Only adjust the "green" border color for light base maps.
  if (status.colorName === "green" && isLightBaseMapStyle(mapStyle)) {
    return [160, 160, 160, 200]
  }

  return status.borderColor
}

// Convenience functions that extract specific properties from getTrafficStatus
export function getTrafficColor(
  delayPercent: number,
  mapStyle?: string
): [number, number, number, number] {
  const status = getTrafficStatus(delayPercent)

  // Only adjust the "green" map rendering color for light base maps.
  if (status.colorName === "green" && isLightBaseMapStyle(mapStyle)) {
    return [0, 160, 0, 255]
  }

  return status.color
}

export function getTrafficBorderColor(
  delayPercent: number,
  mapStyle?: string
): [number, number, number, number] {
  const status = getTrafficStatus(delayPercent)

  // Only adjust the "green" border color for light base maps.
  if (status.colorName === "green" && isLightBaseMapStyle(mapStyle)) {
    return [160, 160, 160, 200]
  }

  return status.borderColor
}

export function getTrafficStatusInfo(delayPercent: number) {
  const status = getTrafficStatus(delayPercent)
  return {
    label: status.label,
    color: status.colorName,
    bg: status.bg,
    bar: status.bar,
    text: status.text,
    icon: status.icon,
  }
}

// Legacy function for old components (traffic-tooltip.tsx)
export function getTrafficStatusConfig(properties: TrafficRoadProperties) {
  const delayPercent = Number(properties.delay_percent || 0)
  const status = getTrafficStatus(delayPercent)
  return {
    label: status.label,
    headerBg: status.headerBg,
    headerTextColor: status.headerTextColor,
    color: delayPercent > 50 ? ("destructive" as const) : ("default" as const),
    icon: status.icon,
    badgeBg: status.badgeBg,
    badgeTextColor: status.badgeTextColor,
  }
}

// Format time in seconds to readable format
export function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`
  }
  const minutes = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`
}

// Format speed
export function formatSpeed(kmph: string | number): string {
  const speed = typeof kmph === "string" ? parseFloat(kmph) : kmph
  return `${speed ? speed.toFixed(1) : "--"} km/h`
}

// Format delay percentage
export function formatDelay(delayPercent: string | number): string {
  const delay =
    typeof delayPercent === "string" ? parseFloat(delayPercent) : delayPercent
  const sign = delay >= 0 ? "+" : ""
  return `${sign}${delay ? delay.toFixed(1) : "--"}%`
}

// Format road length - returns meters if < 100m, otherwise km with 2 decimals
export function formatLength(meters: number): string {
  if (meters < 100) {
    return `${Math.round(meters)} m`
  }
  return `${meters ? (meters / 1000).toFixed(2) : "--"} km`
}

// Arrow generation functions for directional indicators

/**
 * Helper function that returns integer zoom (stepped zoom)
 * Used to ensure arrow size only changes on integer zoom boundaries
 */
export function getSteppedZoom(zoom: number): number {
  return Math.floor(zoom)
}

/**
 * Calculate arrow size based on zoom level
 * Returns null for zoom <= 12 (no arrows)
 * For zoom >= 13, calculates arrow length in meters
 * @param zoom - Current zoom level
 * @param baseLineWidth - Base line width in pixels (for reference)
 * @returns Object with arrowLength (meters) and arrowWidth (pixels), or null if zoom <= 12
 */
export function getArrowSizeForZoom(
  zoom: number,
  baseLineWidth: number
): { arrowLength: number; arrowWidth: number } | null {
  const steppedZoom = getSteppedZoom(zoom)

  // Don't show arrows until zoom level 14
  if (steppedZoom <= 13) {
    return null
  }

  // Base length: 15 meters at zoom 14
  // Scales proportionally: zoom 14 = 18m, zoom 15 = 24m, zoom 16 = 30m, etc.
  const baseLength = 18 // meters at zoom 14
  const arrowLength = baseLength * (1 + (steppedZoom - 14) * 0.33)

  // Arrow width matches line width
  const arrowWidth = baseLineWidth

  return {
    arrowLength,
    arrowWidth,
  }
}

/**
 * Generate arrow lines at the end of a path
 * Creates two GeoJSON LineString features at ±30° from the line direction
 * @param path - Array of coordinates [[lng, lat], ...]
 * @param arrowLength - Length of arrow in meters
 * @returns Array of two GeoJSON LineString features, or empty array if invalid
 */
export function generateArrowLines(
  path: number[][],
  arrowLength: number
): Array<{
  type: "Feature"
  geometry: { type: "LineString"; coordinates: number[][] }
}> {
  // Validate path
  if (!path || !Array.isArray(path) || path.length < 2) {
    return []
  }

  // Find last point
  const lastPoint = path[path.length - 1]
  if (!Array.isArray(lastPoint) || lastPoint.length < 2) {
    return []
  }

  // Find second-last distinct point (walk backwards if points are identical)
  let secondLastPoint: number[] | null = null
  for (let i = path.length - 2; i >= 0; i--) {
    const candidate = path[i]
    if (
      Array.isArray(candidate) &&
      candidate.length >= 2 &&
      (candidate[0] !== lastPoint[0] || candidate[1] !== lastPoint[1])
    ) {
      secondLastPoint = candidate
      break
    }
  }

  // If no distinct point found, cannot calculate bearing
  if (!secondLastPoint) {
    return []
  }

  try {
    // Calculate bearing from second-last to last point
    const fromPoint = point([secondLastPoint[0], secondLastPoint[1]])
    const toPoint = point([lastPoint[0], lastPoint[1]])
    const lineBearing = bearing(fromPoint, toPoint)

    // Create arrow tip points at ±35° from line direction
    const arrowBearing1 = lineBearing + 35 + 180 // Right side of line
    const arrowBearing2 = lineBearing - 35 + 180 // Left side of line

    // Convert arrow length from meters to kilometers for turf.destination
    const arrowLengthKm = (arrowLength + 15) / 1000

    // Create arrow tip points
    const arrowTip1 = destination(
      point([lastPoint[0], lastPoint[1]]),
      arrowLengthKm,
      arrowBearing1
    )
    const arrowTip2 = destination(
      point([lastPoint[0], lastPoint[1]]),
      arrowLengthKm,
      arrowBearing2
    )

    // Extract coordinates from arrow tips
    const tip1Coords = arrowTip1.geometry.coordinates
    const tip2Coords = arrowTip2.geometry.coordinates

    // Create two arrow line features
    const arrowLine1 = lineString(
      [
        [lastPoint[0], lastPoint[1]], // Start from last point
        [tip1Coords[0], tip1Coords[1]], // End at arrow tip 1
      ],
      {}
    )

    const arrowLine2 = lineString(
      [
        [lastPoint[0], lastPoint[1]], // Start from last point
        [tip2Coords[0], tip2Coords[1]], // End at arrow tip 2
      ],
      {}
    )

    return [arrowLine1, arrowLine2]
  } catch (error) {
    console.error("Error generating arrow lines:", error)
    return []
  }
}
