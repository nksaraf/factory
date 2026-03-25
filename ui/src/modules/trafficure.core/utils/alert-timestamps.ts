/**
 * Alert Timestamp Utilities
 * 
 * IMPORTANT: Clear separation between alert start and end times
 * 
 * Platform API Semantics (CRITICAL):
 * - alert_event_time: ALWAYS the alert start time (when alert actually occurred)
 *   - Used for: Both active and resolved alerts
 * - timestamp: Latest update time
 *   - For RESOLVED alerts: timestamp = resolution time (ALERT END TIME)
 *   - For ACTIVE alerts: timestamp = latest update time (NOT significant, NOT end time, alert is ongoing)
 * 
 * UI Model Semantics:
 * - Alert.timestamp: Alert start time (ALWAYS mapped from API alert_event_time, NEVER from timestamp)
 * - Alert.resolvedAt: Alert end time (mapped from API timestamp ONLY for resolved alerts, undefined for active)
 * 
 * RULE: alert_event_time = start time (always). timestamp = end time (resolved only, ignored for active).
 */

import type { Alert } from "../alerts-data"

/**
 * Normalize API timestamp (trim microseconds to milliseconds for JS Date compatibility)
 * Platform API can return RFC3339 with microseconds (6 digits), e.g.:
 * 2026-01-27T19:40:46.359652+05:30
 * JS Date parsing is not consistent with >3 fractional second digits
 */
export function normalizeApiTimestamp(ts: unknown): string | undefined {
  if (typeof ts !== "string" || !ts) return undefined
  return ts.replace(/(\.\d{3})\d+([Z+\-])/, "$1$2")
}

/**
 * Get alert start time (when alert actually occurred)
 * @param alert - The alert object
 * @returns Date object representing when the alert started
 */
export function getAlertStartTime(alert: Alert): Date {
  // Canonical start time: alert_event_time mapped to startedAt.
  // `alert.timestamp` is legacy and should equal startedAt.
  return new Date(alert.startedAt)
}

/**
 * Get alert end time (when alert was resolved, or null if still active)
 * @param alert - The alert object
 * @returns Date object representing when the alert ended, or null if still active
 */
export function getAlertEndTime(alert: Alert): Date | null {
  if (alert.type === "resolved" && alert.resolvedAt) {
    return new Date(alert.resolvedAt)
  }
  return null
}

/**
 * Check if alert is currently active (not resolved)
 * @param alert - The alert object
 * @returns true if alert is active, false if resolved/suppressed
 */
export function isAlertActive(alert: Alert): boolean {
  return alert.type === "active" || (!alert.resolvedAt && alert.type !== "resolved" && alert.type !== "suppressed")
}

/**
 * Calculate alert duration in milliseconds
 * @param alert - The alert object
 * @returns Duration in milliseconds, or null if alert is still active
 */
export function getAlertDurationMs(alert: Alert): number | null {
  const startTime = getAlertStartTime(alert)
  const endTime = getAlertEndTime(alert)
  
  if (!endTime) {
    return null // Alert is still active
  }
  
  return endTime.getTime() - startTime.getTime()
}

/**
 * Calculate alert duration in minutes
 * @param alert - The alert object
 * @returns Duration in minutes, or null if alert is still active
 */
export function getAlertDurationMinutes(alert: Alert): number | null {
  const durationMs = getAlertDurationMs(alert)
  if (durationMs === null) return null
  return Math.floor(durationMs / (60 * 1000))
}

/**
 * Map platform API alert timestamps to UI model
 * @param apiAlert - Raw API alert object (snake_case)
 * @returns Object with normalized startTime and endTime
 */
export function mapApiTimestampsToAlertTimestamps(apiAlert: {
  alert_event_time?: string
  alertEventTime?: string
  timestamp: string
  current_status?: string
}): {
  startTime: string // ISO string for alert start (from alert_event_time)
  lastUpdatedAt: string // ISO string for last update time (from timestamp)
  endTime: string | undefined // ISO string for alert end (from timestamp if resolved), undefined if active
} {
  // Alert start time: MUST be from alert_event_time (NEVER from timestamp)
  // alert_event_time is ALWAYS the alert start time, regardless of alert status
  const alertEventTimeRaw = apiAlert.alert_event_time ?? apiAlert.alertEventTime
  if (!alertEventTimeRaw) {
    console.error(
      "Alert missing alert_event_time field! This is required for alert start time. Using timestamp as emergency fallback.",
      apiAlert
    )
  }
  const normalizedStartTime =
    normalizeApiTimestamp(alertEventTimeRaw) ?? alertEventTimeRaw ?? apiAlert.timestamp

  // Last update time: ALWAYS from timestamp (even for active alerts, informational only)
  const normalizedLastUpdatedAt =
    normalizeApiTimestamp(apiAlert.timestamp) ?? apiAlert.timestamp

  // Alert end time: ONLY for resolved alerts, from timestamp (resolution time)
  // For active alerts: timestamp is NOT significant, so endTime is undefined
  const isResolved = apiAlert.current_status === "RESOLVED"
  const normalizedEndTime = isResolved
    ? normalizedLastUpdatedAt
    : undefined // Active alerts have no end time (timestamp is not significant)

  return {
    startTime: normalizedStartTime,
    lastUpdatedAt: normalizedLastUpdatedAt,
    endTime: normalizedEndTime,
  }
}

