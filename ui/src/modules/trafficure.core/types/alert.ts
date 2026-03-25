/**
 * Alert Domain Model
 *
 * This is the primary type used throughout the UI. It combines API fields
 * with computed/derived fields for display purposes.
 *
 * Created from API data via `transformApiAlertToAlert()` in `alerts-data.ts`.
 */
export interface Alert {
  // ── Identifiers ──────────────────────────────────────────────────────
  /** Unique alert ID from the API */
  alertId: number
  /** String version of alertId, used as React key and URL param */
  id: string
  /** Road segment identifier */
  roadId: string
  /** Full road name (format: "City/ROAD NAME (SEGMENT)") */
  roadName: string

  // ── Classification ───────────────────────────────────────────────────
  /** Alert classification */
  alertType: "CONGESTION" | "RAPID_DETERIORATION"
  /** Alert severity level */
  severity: "WARNING" | "EMERGENCY"
  /** Human-readable reason for the alert */
  reason: string

  // ── Timestamps ───────────────────────────────────────────────────────
  /**
   * When the alert was first triggered.
   * Mapped from API field `alert_event_time`. This is the canonical start time.
   */
  startedAt: string
  /**
   * When the alert data was last refreshed by the API.
   * For resolved alerts, this equals the resolution time.
   * For active alerts, this is informational only.
   */
  lastUpdatedAt?: string
  /**
   * @deprecated Use `startedAt` instead.
   * Legacy alias kept for backward compatibility — always equals `startedAt`.
   */
  timestamp: string
  /** When the alert was resolved (only set for resolved alerts) */
  resolvedAt?: string

  // ── Traffic Metrics (from API) ───────────────────────────────────────
  /** Current travel time on this road segment, in seconds */
  currentTravelTimeSec: number
  /** Typical (expected) travel time on this road segment, in seconds */
  typicalTimeSec: number
  /** Number of consecutive monitoring cycles the alert has been active */
  persistenceCount: number
  /** Current live speed on the road segment, in km/h */
  liveSpeedKmph: number
  /** Rate of speed decrease (0-1, higher = faster deterioration) */
  velocityDecay: number
  /** Congestion saturation (0-1, 1 = fully saturated / stopped traffic) */
  saturationIndex: number
  /** Deviation from typical conditions (0+, higher = worse) */
  deviationIndex: number
  /** Total delay impact in seconds (delay per vehicle * estimated vehicles) */
  impactCostSec: number

  // ── Geometry ─────────────────────────────────────────────────────────
  /** Road segment geometry as a GeoJSON LineString */
  geometry: {
    coordinates: number[][] // Array of [lng, lat] pairs
    type: "LineString"
  }
  /** Representative point for map markers: [lng, lat] */
  coordinates: [number, number]

  // ── Status ───────────────────────────────────────────────────────────
  /** Alert lifecycle state */
  type?: "active" | "suppressed" | "resolved"

  // ── Computed / Derived Fields ────────────────────────────────────────
  /** Display-friendly location (parsed from roadName, typically the road part after "/") */
  location: string
  /** Optional landmark parsed from roadName */
  landmark?: string
  /** Alias for liveSpeedKmph */
  currentSpeed?: number
  /** Alias for currentTravelTimeSec */
  currentTravelTime?: number
  /** Alias for persistenceCount (cycles assumed to be ~1 minute each) */
  persistence?: number
  /** impactCostSec converted to minutes */
  impactMinutes?: number
  /** Alias for saturationIndex */
  congestionLevel?: number
  /** Road segment length in meters (computed from geometry) */
  roadLength?: number

  // ── User Feedback ────────────────────────────────────────────────────
  /** User feedback metadata (stored in PostgREST) */
  metadata?: {
    feedbacks?: Array<{
      type: "dismiss" | "good"
      feedbackText?: string
      timestamp: string
      userId?: string
    }>
    primaryFeedback?: {
      type: "dismiss" | "good"
      feedbackText?: string
      timestamp: string
      userId?: string
    }
  }
}
