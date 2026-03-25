import { type Alert } from "../alerts-data"
import { formatInteger } from "./format-number"
import { getAlertStartTime, getAlertEndTime } from "./alert-timestamps"

// Helper function to format duration in hours and minutes
function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${formatInteger(minutes)} mins`
  }
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (mins === 0) {
    return `${hours}h`
  }
  return `${hours}h ${formatInteger(mins)}m`
}

/**
 * Calculate and format alert duration text based on alert state
 * @param alert - The alert object
 * @returns Object with durationText and optional resolvedText
 */
/**
 * Calculate and format alert duration text based on alert state
 * Uses getAlertStartTime() and getAlertEndTime() for clear timestamp semantics:
 * - Start time: from alert_event_time (always)
 * - End time: from timestamp for resolved alerts, null for active
 */
export function getAlertDurationText(alert: Alert): {
  durationText: string
  resolvedText?: string
} {
  // Use utility functions for clarity: start time is always from alert_event_time
  const alertStartTime = getAlertStartTime(alert)
  const alertEndTime = getAlertEndTime(alert)
  const now = new Date()

  if (alertEndTime) {
    // Resolved alert: calculate duration from start (alert_event_time) to end (timestamp/resolvedAt)
    // Floor both times to the minute to match displayed times, then calculate difference
    const startMinutes = Math.floor(alertStartTime.getTime() / (60 * 1000))
    const endMinutes = Math.floor(alertEndTime.getTime() / (60 * 1000))
    const durationMinutes = endMinutes - startMinutes

    // Calculate time since resolution
    const nowMinutes = Math.floor(now.getTime() / (60 * 1000))
    const resolvedAgoMinutes = nowMinutes - endMinutes

    return {
      durationText: `Went on for ${formatDuration(durationMinutes)}`,
      resolvedText: `Resolved ${formatDuration(resolvedAgoMinutes)} ago`,
    }
  } else {
    // Active alert - calculate from start time (alert_event_time) to now
    // Floor both times to the minute to match displayed times, then calculate difference
    const startMinutes = Math.floor(alertStartTime.getTime() / (60 * 1000))
    const nowMinutes = Math.floor(now.getTime() / (60 * 1000))
    const durationMinutes = nowMinutes - startMinutes

    return {
      durationText: `Ongoing for ${formatDuration(durationMinutes)}`,
    }
  }
}

