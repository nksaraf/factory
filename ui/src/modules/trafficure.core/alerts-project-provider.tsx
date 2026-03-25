import { useMemo } from "react"

import { useCurrentOrganization } from "@rio.js/auth-ui/hooks/use-current-organization"
import { useRio } from "@rio.js/client"
import { envelope, fitBounds } from "@rio.js/geo"
import { WebGISProvider } from "@rio.js/gis/components/web-gis-provider"

import { type Alert } from "./alerts-data"
import { useAlertsQuery } from "./data/alerts"
import { useOrganizationBounds } from "./data/use-organization-bounds"
import { expandBoundsForFocus } from "./utils/expand-bounds"

// Convert alerts data to GeoJSON format
// This will be populated dynamically from the API
function createAlertsGeoJSON(alerts: Alert[]) {
  return {
    type: "FeatureCollection" as const,
    features: alerts.map((alert) => ({
      type: "Feature" as const,
      id: alert.id,
      geometry: {
        type: "Point" as const,
        coordinates: alert.coordinates,
      },
      properties: {
        id: alert.id,
        location: alert.location,
        alertType: alert.alertType,
        severity: alert.severity,
        impactMinutes: alert.impactMinutes || 0,
        roadName: alert.roadName,
      },
    })),
  }
}

// Empty GeoJSON for initial state
const emptyAlertsGeoJSON = createAlertsGeoJSON([])

export function AlertsProjectProvider({ children }) {
  const rio = useRio()
  const { data: activeOrganization } = useCurrentOrganization()
  const orgBounds = useOrganizationBounds()
  const { alerts } = useAlertsQuery(
    {},
    { key: "delay_seconds", sortOrder: "desc" },
    null
  )

  // Calculate bounds from active alerts if available
  const alertsBounds = useMemo(() => {
    if (!alerts || alerts.length === 0) return null

    // Create GeoJSON features from all alert geometries
    const features = alerts.map((alert) => ({
      type: "Feature" as const,
      geometry: alert.geometry,
      properties: {
        id: alert.id,
      },
    }))

    const featureCollection = {
      type: "FeatureCollection" as const,
      features,
    }

    try {
      const env = envelope(featureCollection as any)
      const rawBounds: [[number, number], [number, number]] = [
        [env.bbox[0], env.bbox[1]],
        [env.bbox[2], env.bbox[3]],
      ]
      return expandBoundsForFocus(rawBounds)
    } catch (error) {
      console.error("Failed to calculate alerts bounds:", error)
      return null
    }
  }, [alerts])

  const viewState = useMemo(() => {
    // Priority: alerts bounds > org bounds > India fallback
    if (alertsBounds) {
      const fitted = fitBounds({
        bounds: alertsBounds,
        width: window.innerWidth * 0.75,
        height: window.innerHeight * 0.9,
      })
      // Zoom out a bit so alerts aren't too tight in frame
      const zoom =
        fitted.zoom != null ? Math.max(1, fitted.zoom - 0.7) : fitted.zoom
      return { ...fitted, zoom }
    }

    if (orgBounds?.bounds) {
      return fitBounds({
        bounds: orgBounds.bounds as [[number, number], [number, number]],
        width: window.innerWidth * 0.75,
        height: window.innerHeight * 0.9,
      })
    }

    // Default bounds of India
    return fitBounds({
      bounds: [
        [68.18, 8.47],
        [97.4, 37.06],
      ],
      width: window.innerWidth,
      height: window.innerHeight,
    })
  }, [alertsBounds, orgBounds?.bounds])

  return (
    <>
      <WebGISProvider
        initialProject={{
          maps: {
            main: {
              id: "main",
              provider: "google",
              style: "light-street",
              visible: true,
              settings: {
                apiKey: rio.env.PUBLIC_GOOGLE_MAPS_API_KEY,
                gestureHandling: "greedy",
                mapId: "73a66895f21ab8d1af4c7933",
              },
            },
          },
          viewState: {
            main: viewState,
          },
          layers: {
            traffic: {
              id: "traffic",
              featureType: "mvt",
              rendererType: "traffic",
              source: {
                url: "https://api.traffic.management.tiler.rio.software/public.traffic_segments_tiles_v1.json",
                type: "mvt_url",
              },
              style: {
                pointRadius: 1000,
                canHover: false,
                canClick: false,
              },
              name: "Traffic",
              visible: true,
            },
            alerts: {
              id: "alerts",
              featureType: "geojson",
              rendererType: "alerts",
              source: {
                data: emptyAlertsGeoJSON,
                type: "geojson",
              },
              style: {
                pointRadius: 1000,
              },
              name: "Alerts",
              visible: true,
            },
          },
        }}
        key={activeOrganization?.id}
        id={`alerts/${activeOrganization?.id}`}
        onProjectChange={async () => {
          return true
        }}
      >
        {children}
      </WebGISProvider>
    </>
  )
}
