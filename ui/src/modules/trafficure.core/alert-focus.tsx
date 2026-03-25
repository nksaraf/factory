import { useEffect } from "react"

import { fitBounds, envelope as turfEnvelope } from "@rio.js/geo"
import { useLayerData } from "@rio.js/gis/hooks/use-layer-data"
import { useProject } from "@rio.js/gis/store"
import { expandBoundsForFocus } from "./utils/expand-bounds"

export function AlertFocus({ alertId }: { alertId: string }) {
  const project = useProject()
  const alertsData = useLayerData("alerts")

  useEffect(() => {
    if (!alertsData?.features?.length || !project) return

    const alert = alertsData.features.find(
      (f: any) => f.properties?.id === alertId || f.id === alertId
    )

    if (!alert) return

    try {
      // Create a feature collection with just this alert
      const featureCollection = {
        type: "FeatureCollection",
        features: [alert],
      }

      const envelope = turfEnvelope(featureCollection)
      const rawBounds: [[number, number], [number, number]] = [
        [envelope.bbox[0], envelope.bbox[1]],
        [envelope.bbox[2], envelope.bbox[3]],
      ]
      const bounds = expandBoundsForFocus(rawBounds)

      const viewState = fitBounds({
        bounds,
        width: 1600,
        height: 560,
        padding: 36,
      })

      const baseZoom = viewState.zoom ?? 14
      const isLineGeometry =
        alert.geometry.type === "LineString" ||
        alert.geometry.type === "MultiLineString"
      if (isLineGeometry) {
        // Small zoom bump for road alerts so we focus a bit closer
        viewState.zoom = Math.min(baseZoom + 0.35, 18)
      } else {
        viewState.zoom = Math.min(baseZoom + 0.7, 18)
        if (alert.geometry.type === "Point") {
          viewState.zoom = Math.max(viewState.zoom, 14)
        }
      }

      project.setViewStateRow("main", viewState)
    } catch (error) {
      console.error("Error focusing on alert:", error)
    }
  }, [alertId, alertsData, project])

  return null
}
