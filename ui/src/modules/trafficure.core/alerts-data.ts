/**
 * Alert Data — Transformation & Helpers
 *
 * Type definitions live in ./types/ (see types/alert.ts, types/alert-api.ts).
 * This file re-exports them for backward compatibility and provides the
 * transformApiAlertToAlert() function that maps API responses to domain models.
 */
import { length as lineLength } from "@rio.js/geo"

// Re-export types from canonical location for backward compatibility
export type { Alert } from "./types/alert"
export type { AlertApiItem, AlertApiResponse } from "./types/alert-api"

// Import for use in this file
import type { Alert } from "./types/alert"
import type { AlertApiItem } from "./types/alert-api"


// Transform API response item to Alert with computed fields
export function transformApiAlertToAlert(apiAlert: AlertApiItem): Alert {
  // Extract first coordinate from geometry for point representation
  // Use @rio.js/geo to get the center of the LineString
  // const geojson = {
  //   type: "Feature",
  //   geometry: apiAlert.geometry,
  //   properties: {}
  // }
  // const centerFeature = center(geojson)
  const centerCoord = apiAlert.displayPoint.coordinates as [number, number]
  const coordinates: [number, number] = centerCoord

  // Parse roadName to extract location and potentially landmark
  // Format: "City/ROAD NAME (SEGMENT)" or similar
  const roadNameParts = apiAlert.roadName.split("/")
  const location =
    roadNameParts.length > 1 ? roadNameParts[1] : apiAlert.roadName
  const roadLength = lineLength(
    {
      type: "Feature",
      geometry: apiAlert.geometry,
      properties: {},
    },
    {
      units: "meters",
    }
  )

  // Convert persistenceCount (cycles) to minutes (assuming 1 cycle = 1 minute)
  // This might need adjustment based on actual cycle duration
  const persistence = apiAlert.persistenceCount

  // Convert impactCostSec to minutes
  const impactMinutes = apiAlert.impactCostSec / 60

  return {
    // API fields (canonical)
    ...apiAlert,
    // Normalize timestamps:
    // - startedAt is canonical for alert start time
    // - lastUpdatedAt is informational for active alerts
    // - timestamp is legacy alias for startedAt to avoid breaking older UI
    startedAt: apiAlert.startedAt ?? apiAlert.timestamp,
    lastUpdatedAt: apiAlert.lastUpdatedAt,
    timestamp: apiAlert.startedAt ?? apiAlert.timestamp,
    // Computed fields
    id: String(apiAlert.alertId),
    location,
    coordinates,
    currentSpeed: apiAlert.liveSpeedKmph,
    currentTravelTime: apiAlert.currentTravelTimeSec,
    persistence,
    roadLength,
    impactMinutes,
    congestionLevel: apiAlert.saturationIndex,
  }
}

// Legacy sample alerts - kept for backward compatibility during migration
export const sampleAlerts: Alert[] = []

export function getAlertById(
  id: string,
  alerts: Alert[] = []
): Alert | undefined {
  return alerts.find((alert) => alert.id === id)
}
