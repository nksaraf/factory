/**
 * Alert API Types
 *
 * These types represent the raw API response format from the platform API.
 * The API returns snake_case fields; these are mapped to camelCase domain types
 * via `transformApiAlertToAlert()` in `alerts-data.ts`.
 */

/** Single alert item from the API (camelCase normalized) */
export interface AlertApiItem {
  roadId: string
  roadName: string
  alertType: "CONGESTION" | "RAPID_DETERIORATION"
  severity: "WARNING" | "EMERGENCY"
  reason: string
  /**
   * @deprecated Prefer startedAt/lastUpdatedAt.
   * For legacy backends this may be start time; for platform backends it's last update time.
   */
  timestamp: string
  /** Alert start time (from API alert_event_time) */
  startedAt?: string
  /** Last update time (from API timestamp) */
  lastUpdatedAt?: string
  currentTravelTimeSec: number
  typicalTimeSec: number
  persistenceCount: number
  liveSpeedKmph: number
  velocityDecay: number
  saturationIndex: number
  deviationIndex: number
  impactCostSec: number
  geometry: {
    coordinates: number[][]
    type: "LineString"
  }
  displayPoint: {
    coordinates: [number, number]
    type: "Point"
  }
  alertId: number
  type?: "active" | "suppressed" | "resolved"
  resolvedAt?: string
}

/** Aggregated API response containing alerts and summary statistics */
export interface AlertApiResponse {
  alerts: AlertApiItem[]
  totalCount: number
  /** Count of alerts grouped by alertType (e.g., { "CONGESTION": 5, "RAPID_DETERIORATION": 3 }) */
  byType: Record<string, number>
  /** Count of alerts grouped by severity (e.g., { "WARNING": 6, "EMERGENCY": 2 }) */
  bySeverity: Record<string, number>
}
