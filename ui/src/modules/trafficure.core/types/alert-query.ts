/**
 * Alert Query Types
 *
 * Types used by AlertsQueryContext for managing alert list state:
 * sorting, filtering, and time range selection.
 */

/** Sort keys available for the live (active) alerts tab */
export type LiveAlertsSortKey =
  | "delay_seconds"
  | "deviation_index"
  | "duration"
  | "started_at"

/** Sort keys available for the historical (resolved) alerts tab */
export type HistoricalAlertsSortKey =
  | "resolved_at"
  | "duration"
  | "started_at"

/** Sort configuration for alert lists */
export type AlertsSort = {
  key: LiveAlertsSortKey | HistoricalAlertsSortKey
  sortOrder: "asc" | "desc"
}

/** Filter options for alert lists */
export type AlertsFilters = {
  searchTerm?: string
}

/** Preset time ranges for historical alert queries */
export type HistoricalTimeRange = "20m" | "1h" | "6h" | "1d" | "2d" | null
