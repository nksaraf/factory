/**
 * Centralized Alert Type Configuration
 *
 * This file contains all alert type definitions including labels, colors, icons,
 * and styling. Import from this file to ensure consistency across the application.
 */

// Alert type enum values (matches API)
export const ALERT_TYPES = {
  CONGESTION: "CONGESTION",
  RAPID_DETERIORATION: "RAPID_DETERIORATION",
} as const

export type AlertTypeKey = keyof typeof ALERT_TYPES

// Severity order (lower number = more severe, appears first in lists)
export const ALERT_TYPE_SEVERITY_ORDER: Record<AlertTypeKey, number> = {
  RAPID_DETERIORATION: 0, // Most severe
  CONGESTION: 1,
}

// Human-readable labels
export const ALERT_TYPE_LABELS: Record<AlertTypeKey, string> = {
  CONGESTION: "Congestion",
  RAPID_DETERIORATION: "Surge",
}

// Uppercase labels (for mobile/compact views)
export const ALERT_TYPE_LABELS_UPPER: Record<AlertTypeKey, string> = {
  CONGESTION: "CONGESTION",
  RAPID_DETERIORATION: "SURGE",
}

// Icons for each alert type
export const ALERT_TYPE_ICONS: Record<AlertTypeKey, string> = {
  CONGESTION: "icon-[ph--lightning-duotone]",
  RAPID_DETERIORATION: "icon-[ph--traffic-sign-duotone]",
}

// RGB colors for deck.gl/map layers (format: [R, G, B, A])
export const ALERT_TYPE_RGB_COLORS: Record<
  AlertTypeKey,
  readonly [number, number, number, number]
> = {
  CONGESTION: [239, 69, 68, 255], // red (Tailwind red-500)
  RAPID_DETERIORATION: [234, 179, 8, 255], // yellow (Tailwind yellow-500)
}

// RGB colors for borders (matching traffic layer darkest variants)
export const ALERT_TYPE_RGB_BORDER_COLORS: Record<
  AlertTypeKey,
  readonly [number, number, number, number]
> = {
  CONGESTION: [139, 26, 26, 255], // Dark red - matches traffic >100% delay (stopped traffic)
  RAPID_DETERIORATION: [245, 124, 0, 255], // Dark orange - matches traffic 25-50% delay (heavy traffic)
}

// Tailwind color classes
export const ALERT_TYPE_COLORS = {
  CONGESTION: {
    // Primary colors
    primary: "red",
    // Text colors
    text: "text-red-500",
    textDark: "text-red-600",
    textOnBg: "text-white",
    // Background colors
    bg: "bg-red-500",
    bgLight: "bg-red-50",
    bgHeader: "bg-red-100",
    // Border colors
    border: "border-red-300",
    borderDark: "border-red-600",
    // Hover states
    hoverBorder: "hover:border-red-400",
    hoverBg: "hover:bg-red-100",
    hoverText: "hover:text-red-800",
  },
  RAPID_DETERIORATION: {
    // Primary colors
    primary: "yellow",
    // Text colors
    text: "text-yellow-500",
    textDark: "text-yellow-600",
    textOnBg: "text-white",
    // Background colors
    bg: "bg-yellow-500",
    bgLight: "bg-yellow-50",
    bgHeader: "bg-yellow-100",
    // Border colors
    border: "border-yellow-300",
    borderDark: "border-yellow-600",
    // Hover states
    hoverBorder: "hover:border-yellow-400",
    hoverBg: "hover:bg-yellow-100",
    hoverText: "hover:text-yellow-800",
  },
} as const

// Full configuration for UI components (inbox, cards, etc.)
export const ALERT_TYPE_CONFIG = {
  CONGESTION: {
    label: ALERT_TYPE_LABELS.CONGESTION,
    labelUpper: ALERT_TYPE_LABELS_UPPER.CONGESTION,
    icon: ALERT_TYPE_ICONS.CONGESTION,
    // Header styling
    headerBg: "bg-red-100",
    headerTextColor: "text-red-500",
    // Badge styling
    badgeBg: "bg-red-500",
    badgeTextColor: "text-white",
    // Variant for UI components
    color: "destructive",
    // Pill colors for map overlay
    pillBgColor: "bg-red-500",
    pillTextColor: "text-white",
    pillBorderColor: "border-red-600",
  },
  RAPID_DETERIORATION: {
    label: ALERT_TYPE_LABELS.RAPID_DETERIORATION,
    labelUpper: ALERT_TYPE_LABELS_UPPER.RAPID_DETERIORATION,
    icon: ALERT_TYPE_ICONS.RAPID_DETERIORATION,
    // Header styling
    headerBg: "bg-yellow-100",
    headerTextColor: "text-yellow-500",
    // Badge styling
    badgeBg: "bg-yellow-500",
    badgeTextColor: "text-white",
    // Variant for UI components
    color: "warning",
    // Pill colors for map overlay
    pillBgColor: "bg-yellow-500",
    pillTextColor: "text-white",
    pillBorderColor: "border-yellow-600",
  },
} as const

// Color schemes for pills (speed, factor, persistence indicators)
export const ALERT_TYPE_PILL_COLORS = {
  CONGESTION: {
    speed: {
      border: "border-red-300",
      bg: "bg-red-50",
      text: "text-red-700",
      hoverBorder: "border-red-400",
      hoverBg: "bg-red-100",
      hoverText: "text-red-800",
    },
    factor: {
      border: "border-red-300",
      bg: "bg-red-50",
      text: "text-red-700",
      hoverBorder: "border-red-400",
      hoverBg: "bg-red-100",
      hoverText: "text-red-800",
    },
    persistence: {
      border: "border-red-300",
      bg: "bg-red-50",
      text: "text-red-700",
      hoverBorder: "border-red-400",
      hoverBg: "bg-red-100",
      hoverText: "text-red-800",
    },
  },
  RAPID_DETERIORATION: {
    speed: {
      border: "border-yellow-300",
      bg: "bg-yellow-50",
      text: "text-yellow-700",
      hoverBorder: "border-yellow-400",
      hoverBg: "bg-yellow-100",
      hoverText: "text-yellow-800",
    },
    factor: {
      border: "border-yellow-300",
      bg: "bg-yellow-50",
      text: "text-yellow-700",
      hoverBorder: "border-yellow-400",
      hoverBg: "bg-yellow-100",
      hoverText: "text-yellow-800",
    },
    persistence: {
      border: "border-yellow-300",
      bg: "bg-yellow-50",
      text: "text-yellow-700",
      hoverBorder: "border-yellow-400",
      hoverBg: "bg-yellow-100",
      hoverText: "text-yellow-800",
    },
  },
} as const

// Legend descriptions (for tooltip/legend explanations)
export const ALERT_TYPE_DESCRIPTIONS: Record<
  AlertTypeKey,
  { start: string[]; clear: string[] }
> = {
  CONGESTION: {
    start: [
      "Speed ratio drops below 0.65 (65% of typical speed)",
      "Delay intensity exceeds by 90 sec/km",
    ],
    clear: [
      "Speed ratio rises above 0.85 (85% of typical speed)",
      "Delay intensity falls below 67 sec/km",
    ],
  },
  RAPID_DETERIORATION: {
    start: [
      "Speed drops by more than 15% or by more than 8 km/h in a period of 6 minutes",
      "Current speed ratio is below 0.80 (80% of typical speed)",
    ],
    clear: ["Speed ratio recovers above 0.85 (85% of typical speed) "],
  },
}

// Tooltip messages for alert pills
export const ALERT_TYPE_TOOLTIPS: Record<AlertTypeKey, string> = {
  CONGESTION:
    "Congestion Alert (Priority 2): Detects sustained periods of slow traffic where vehicles are moving significantly slower than typical conditions (speed ratio < 65%) and experiencing notable delays (delay intensity > 90 sec/km). Requires conditions to persist for 2 consecutive cycles (4 minutes) before triggering.",
  RAPID_DETERIORATION:
    "Rapid Deterioration Alert (Priority 1): Detects sudden, significant drops in speed (15%+ and 8+ km/h) compared to 6 minutes ago, indicating a developing incident or rapidly worsening conditions. Triggers immediately when conditions are met (no persistence required). Can escalate to CONGESTION if conditions persist.",
}

// Map sizes (radius) based on alert type
export const ALERT_TYPE_MAP_SIZES: Record<AlertTypeKey, number> = {
  RAPID_DETERIORATION: 14, // Largest (most severe)
  CONGESTION: 9,
}

// Helper function to get RGB color for a given alert type
export function getAlertTypeRgbColor(
  alertType: AlertTypeKey
): readonly [number, number, number, number] {
  return ALERT_TYPE_RGB_COLORS[alertType] || ALERT_TYPE_RGB_COLORS.CONGESTION
}

// Helper function to get RGB border color for a given alert type
export function getAlertTypeRgbBorderColor(
  alertType: AlertTypeKey
): readonly [number, number, number, number] {
  return (
    ALERT_TYPE_RGB_BORDER_COLORS[alertType] ||
    ALERT_TYPE_RGB_BORDER_COLORS.CONGESTION
  )
}

// Helper function to get label for a given alert type
export function getAlertTypeLabel(alertType: AlertTypeKey): string {
  return ALERT_TYPE_LABELS[alertType] || "Alert"
}

// Helper function to get icon for a given alert type
export function getAlertTypeIcon(alertType: AlertTypeKey): string {
  return ALERT_TYPE_ICONS[alertType] || ALERT_TYPE_ICONS.CONGESTION
}

// Helper function to get config for a given alert type
export function getAlertTypeConfig(alertType: AlertTypeKey) {
  return ALERT_TYPE_CONFIG[alertType] || ALERT_TYPE_CONFIG.CONGESTION
}

// Helper function to sort alerts by severity
export function sortAlertsBySeverity<T extends { alertType: AlertTypeKey }>(
  alerts: T[]
): T[] {
  return [...alerts].sort((a, b) => {
    return (
      ALERT_TYPE_SEVERITY_ORDER[a.alertType] -
      ALERT_TYPE_SEVERITY_ORDER[b.alertType]
    )
  })
}
