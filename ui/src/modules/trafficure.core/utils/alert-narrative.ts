import type { Alert } from "../alerts-data"
import type { TrafficMetric } from "../data/use-traffic-metrics"
import {
  getAlertEndTime,
  getAlertStartTime,
} from "./alert-timestamps"
import { formatDecimal, formatInteger } from "./format-number"
import { formatTimeWithSmartDate } from "./format-time"

export type AlertNarrativeToken =
  | { type: "text"; value: string }
  | {
      type: "metric"
      label?: string
      value: string
      tone: "critical" | "warning" | "neutral" | "positive"
    }
  | {
      type: "icon"
      name: "speed-down" | "speed-up" | "time" | "alert" | "check"
    }
  | { type: "line-break" }

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Format date/time for narrative display: "time today" if today, otherwise full date format
 */
function formatTimeForNarrative(isoString: string | null | undefined): string {
  if (!isoString) {
    return "N/A"
  }

  try {
    const date = new Date(isoString)
    if (isNaN(date.getTime())) {
      return "N/A"
    }

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate())

    // Format as 12-hour time with AM/PM
    const hours = date.getHours()
    const minutes = date.getMinutes()
    const ampm = hours >= 12 ? "PM" : "AM"
    const displayHours = hours % 12 || 12
    const displayMinutes = minutes.toString().padStart(2, "0")
    const timeString = `${displayHours}:${displayMinutes} ${ampm}`

    // Check if it's today
    if (dateOnly.getTime() === today.getTime()) {
      return `${timeString} today`
    }

    // For other dates, use formatTimeWithSmartDate
    return formatTimeWithSmartDate(isoString)
  } catch (error) {
    console.error("Error formatting time for narrative:", error)
    return "N/A"
  }
}

function formatDurationPhrase(minutes: number): string {
  const rounded = Math.max(1, Math.round(minutes))

  if (rounded < 60) {
    return `${formatInteger(rounded)} minutes`
  }

  const hours = Math.floor(rounded / 60)

  if (hours === 1) {
    if (rounded >= 75) {
      return "over 1 hour"
    }
    return "about 1 hour"
  }

  return `over ${formatInteger(hours)} hours`
}

function formatDelayMinutes(impactMinutes: number | undefined): string | null {
  if (!impactMinutes || impactMinutes <= 0) return null
  const clamped = clamp(impactMinutes, 0.5, 240)

  if (clamped < 1) {
    return "under 1 minute"
  }

  if (clamped < 60) {
    return `${formatInteger(clamped)} minutes`
  }

  const hours = Math.floor(clamped / 60)
  const mins = Math.round(clamped % 60)

  if (hours === 1 && mins < 15) {
    return "about 1 hour"
  }

  if (hours === 1) {
    return `about 1 hour ${formatInteger(mins)} minutes`
  }

  if (mins === 0) {
    return `${formatInteger(hours)} hours`
  }

  return `${formatInteger(hours)}h ${formatInteger(mins)}m`
}

function getSeverityTone(alert: Alert): "critical" | "warning" | "neutral" {
  const deviation = alert.deviationIndex
  const saturation = alert.saturationIndex
  const impactMinutes =
    alert.impactMinutes ??
    (alert.impactCostSec ? alert.impactCostSec / 60 : undefined)

  if (
    (deviation && deviation >= 1.8) ||
    saturation >= 3 ||
    (impactMinutes && impactMinutes >= 10)
  ) {
    return "critical"
  }

  if (
    (deviation && deviation >= 1.3) ||
    saturation >= 2 ||
    (impactMinutes && impactMinutes >= 5)
  ) {
    return "warning"
  }

  return "neutral"
}

/**
 * Find the closest metric to a given time
 */
function findMetricAtTime(
  metrics: TrafficMetric[],
  targetTime: Date,
  maxDiffMinutes = 5
): TrafficMetric | null {
  if (!metrics || metrics.length === 0) return null

  const targetTimeMs = targetTime.getTime()
  let closest: TrafficMetric | null = null
  let minDiff = Infinity

  for (const metric of metrics) {
    const metricTime = new Date(metric.traffic_event_time).getTime()
    const diff = Math.abs(metricTime - targetTimeMs)
    const diffMinutes = diff / (60 * 1000)

    if (diffMinutes <= maxDiffMinutes && diff < minDiff) {
      minDiff = diff
      closest = metric
    }
  }

  return closest
}

/**
 * Find speed before alert started (for calculating actual drop)
 */
function findSpeedBeforeAlert(
  metrics: TrafficMetric[],
  alertStartTime: Date
): { speed: number; time: Date; timeFormatted: string } | null {
  if (!metrics || metrics.length === 0) return null

  // Look for metrics 10-15 minutes before alert start
  const beforeTime = new Date(alertStartTime.getTime() - 12 * 60 * 1000) // 12 minutes before
  const metric = findMetricAtTime(metrics, beforeTime, 8) // Allow 8 min window

  if (metric && metric.calculated_speed_kmph > 0) {
    return {
      speed: metric.calculated_speed_kmph,
      time: new Date(metric.traffic_event_time),
      timeFormatted: formatTimeForNarrative(metric.traffic_event_time),
    }
  }

  return null
}

/**
 * Find speed at alert start
 */
function findSpeedAtAlertStart(
  metrics: TrafficMetric[],
  alertStartTime: Date
): { speed: number; timeFormatted: string } | null {
  const metric = findMetricAtTime(metrics, alertStartTime, 5)
  if (metric && metric.calculated_speed_kmph > 0) {
    return {
      speed: metric.calculated_speed_kmph,
      timeFormatted: formatTimeForNarrative(metric.traffic_event_time),
    }
  }
  return null
}

/**
 * Find when speed recovered (for resolved alerts)
 */
function findSpeedRecovery(
  metrics: TrafficMetric[],
  alertEndTime: Date
): { speed: number; time: Date; timeFormatted: string } | null {
  if (!metrics || metrics.length === 0) return null

  // Look for metrics around resolution time and after
  const recoveryWindow = new Date(alertEndTime.getTime() + 10 * 60 * 1000) // 10 min after
  const metric = findMetricAtTime(metrics, recoveryWindow, 10)

  if (metric && metric.calculated_speed_kmph > 0) {
    return {
      speed: metric.calculated_speed_kmph,
      time: new Date(metric.traffic_event_time),
      timeFormatted: formatTimeForNarrative(metric.traffic_event_time),
    }
  }

  return null
}

/**
 * Calculate average speed and average usual speed during alert period
 * Returns average actual speed, average usual speed, and percentage below usual
 */
function calculateAverageSpeedsDuringAlert(
  metrics: TrafficMetric[],
  alertStartTime: Date,
  alertEndTime: Date | null
): {
  avgActualSpeed: number | null
  avgTypicalSpeed: number | null
  percentBelowTypical: number | null
} {
  if (!metrics || metrics.length === 0) {
    return { avgActualSpeed: null, avgTypicalSpeed: null, percentBelowTypical: null }
  }

  const endTime = alertEndTime || new Date()
  const startTimestamp = alertStartTime.getTime()
  const endTimestamp = endTime.getTime()

  // Filter metrics to only those within the alert period
  const metricsDuringAlert = metrics.filter((metric) => {
    const metricTime = new Date(metric.traffic_event_time).getTime()
    return metricTime >= startTimestamp && metricTime <= endTimestamp && metric.calculated_speed_kmph > 0
  })

  if (metricsDuringAlert.length === 0) {
    return { avgActualSpeed: null, avgTypicalSpeed: null, percentBelowTypical: null }
  }

  // Calculate average actual speed
  const totalActualSpeed = metricsDuringAlert.reduce(
    (sum, metric) => sum + metric.calculated_speed_kmph,
    0
  )
  const avgActualSpeed = totalActualSpeed / metricsDuringAlert.length

  // Calculate average usual speed (usual = actual * deviation_index)
  const totalTypicalSpeed = metricsDuringAlert.reduce((sum, metric) => {
    const typicalSpeed = metric.calculated_speed_kmph * metric.deviation_index
    return sum + typicalSpeed
  }, 0)
  const avgTypicalSpeed = totalTypicalSpeed / metricsDuringAlert.length

  // Calculate percentage below typical
  let percentBelowTypical: number | null = null
  if (avgTypicalSpeed > 0) {
    percentBelowTypical = Math.round(((avgTypicalSpeed - avgActualSpeed) / avgTypicalSpeed) * 100)
  }

  return {
    avgActualSpeed: Math.round(avgActualSpeed * 10) / 10,
    avgTypicalSpeed: Math.round(avgTypicalSpeed * 10) / 10,
    percentBelowTypical,
  }
}

function buildActiveAlertNarrative(
  alert: Alert,
  metrics?: TrafficMetric[]
): AlertNarrativeToken[] {
  const tokens: AlertNarrativeToken[] = []

  const startTime = getAlertStartTime(alert)

  const liveSpeed = alert.liveSpeedKmph
  const deviation = alert.deviationIndex
  const saturation = alert.saturationIndex
  const impactMinutes =
    alert.impactMinutes ??
    (alert.impactCostSec ? alert.impactCostSec / 60 : undefined)
  const velocityDecay = alert.velocityDecay

  const travelMultiplier = deviation || saturation || null
  const severityTone = getSeverityTone(alert)

  // Use metrics data to calculate accurate speed drop
  let speedBefore: { speed: number; time: Date; timeFormatted: string } | null = null
  let speedAtStart: { speed: number; timeFormatted: string } | null = null

  if (metrics && metrics.length > 0) {
    speedBefore = findSpeedBeforeAlert(metrics, startTime)
    speedAtStart = findSpeedAtAlertStart(metrics, startTime)
  }

  // Calculate actual speed drop percentage using metrics data
  let speedDropPercent: number | null = null

  if (speedBefore && speedAtStart && speedBefore.speed > 0) {
    const drop = speedBefore.speed - speedAtStart.speed
    if (drop > 0) {
      speedDropPercent = Math.round((drop / speedBefore.speed) * 100)
    }
  } else if (velocityDecay && velocityDecay > 0 && liveSpeed > 0) {
    // Fallback to velocity decay if metrics not available
    const estimatedPreviousSpeed = liveSpeed + velocityDecay
    if (estimatedPreviousSpeed > 0) {
      speedDropPercent = Math.round((velocityDecay / estimatedPreviousSpeed) * 100)
    }
  }

  // Bullet 1: Why alert was formed (speed drop with accurate timing) - more human-friendly
  if (liveSpeed > 0) {
    if (speedBefore && speedAtStart && speedBefore.speed > 0 && speedDropPercent && speedDropPercent > 20) {
      // Use actual metrics data with more natural language
      tokens.push({
        type: "text",
        value: `Traffic slowed significantly, dropping from `,
      })
      tokens.push({
        type: "metric",
        value: `${formatInteger(speedBefore.speed)} km/h`,
        tone: "neutral",
      })
      tokens.push({
        type: "text",
        value: ` to `,
      })
      tokens.push({
        type: "metric",
        value: `${formatInteger(speedAtStart.speed)} km/h`,
        tone: severityTone,
      })
      tokens.push({
        type: "text",
        value: ` (a `,
      })
      tokens.push({
        type: "metric",
        value: `${speedDropPercent}% reduction in speed)`,
        tone: "critical",
      })

    } else if (speedDropPercent && speedDropPercent > 20) {
      // Fallback: use velocity decay estimate
      tokens.push({
        type: "text",
        value: `Traffic speed dropped by `,
      })
      tokens.push({
        type: "metric",
        value: `${speedDropPercent}%`,
        tone: "critical",
      })
      tokens.push({
        type: "text",
        value: ` over the past 10 minutes`,
      })
    } else {
      // No significant drop percentage, just show current speed
      tokens.push({
        type: "text",
        value: `Traffic speed is currently `,
      })
      tokens.push({
        type: "metric",
        value: `${formatInteger(liveSpeed)} km/h`,
        tone: severityTone,
      })
    }
    tokens.push({ type: "line-break" })
  }

  // Bullet 2: Current impact (travel time multiplier and delay) - more human-friendly
  if (travelMultiplier && travelMultiplier > 1.1) {
    tokens.push({ type: "icon", name: "time" })
    tokens.push({
      type: "text",
      value: `Drivers are experiencing `,
    })
    tokens.push({
      type: "metric",
      value: `${formatDecimal(travelMultiplier)}× longer travel times`,
      tone: severityTone,
    })
    if (impactMinutes && impactMinutes > 0) {
      const delayPhrase = formatDelayMinutes(impactMinutes)
      if (delayPhrase) {
        tokens.push({
          type: "text",
          value: `, with an average delay of `,
        })
        tokens.push({
          type: "metric",
          value: delayPhrase,
          tone: severityTone,
        })
        tokens.push({
          type: "text",
          value: ` per vehicle`,
        })
      }
    }
    tokens.push({ type: "line-break" })
  }

  return tokens
}

function buildResolvedAlertNarrative(
  alert: Alert,
  metrics?: TrafficMetric[]
): AlertNarrativeToken[] {
  const tokens: AlertNarrativeToken[] = []

  const startTime = getAlertStartTime(alert)
  const endTime = getAlertEndTime(alert)
  const endTimeFormatted = endTime
    ? formatTimeForNarrative(alert.resolvedAt || alert.timestamp)
    : null

  const liveSpeed = alert.liveSpeedKmph

  // Use metrics to find actual speed recovery
  let speedRecovery: { speed: number; time: Date; timeFormatted: string } | null = null
  if (metrics && metrics.length > 0 && endTime) {
    speedRecovery = findSpeedRecovery(metrics, endTime)
  }

  // Bullet 1: When and why resolved (speed recovery with actual data) - more human-friendly
  tokens.push({
    type: "text",
    value: `Alert resolved at `,
  })
  if (endTimeFormatted) {
    tokens.push({
      type: "metric",
      value: endTimeFormatted,
      tone: "neutral",
    })
  }

  if (speedRecovery && speedRecovery.speed > 0) {
    // Use actual recovery speed from metrics
    tokens.push({
      type: "text",
      value: ` when traffic speed recovered to `,
    })
    tokens.push({
      type: "metric",
      value: `${formatInteger(speedRecovery.speed)} km/h`,
      tone: "positive",
    })
  } else if (liveSpeed && liveSpeed > 0) {
    // Fallback to alert's live speed
    tokens.push({
      type: "text",
      value: ` when traffic speed recovered to `,
    })
    tokens.push({
      type: "metric",
      value: `${formatInteger(liveSpeed)} km/h`,
      tone: "positive",
    })
  }
  tokens.push({ type: "line-break" })

  // Bullet 2: Average speed during alert period
  const speedStats = calculateAverageSpeedsDuringAlert(metrics || [], startTime, endTime)
  if (speedStats.avgActualSpeed !== null && speedStats.avgTypicalSpeed !== null && speedStats.percentBelowTypical !== null) {
    tokens.push({
      type: "text",
      value: `Average speed during this alert was `,
    })
    tokens.push({
      type: "metric",
      value: `${formatDecimal(speedStats.avgActualSpeed)} km/h`,
      tone: "warning",
    })
    tokens.push({
      type: "text",
      value: `, which is `,
    })
    tokens.push({
      type: "metric",
      value: `${speedStats.percentBelowTypical}%`,
      tone: "warning",
    })
    tokens.push({
      type: "text",
      value: ` less than the usual speed of `,
    })
    tokens.push({
      type: "metric",
      value: `${formatDecimal(speedStats.avgTypicalSpeed)} km/h`,
      tone: "neutral",
    })
    tokens.push({ type: "line-break" })
  }

  return tokens
}

export function buildAlertNarrative(
  alert: Alert,
  metrics?: TrafficMetric[]
): AlertNarrativeToken[] {
  if (!alert) return []

  if (alert.type === "resolved" && alert.resolvedAt) {
    return buildResolvedAlertNarrative(alert, metrics)
  }

  return buildActiveAlertNarrative(alert, metrics)
}


