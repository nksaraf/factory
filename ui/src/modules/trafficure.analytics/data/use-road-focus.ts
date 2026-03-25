import { useEffect } from "react"

import { useAppState } from "@rio.js/client"
import { fitBounds, envelope as turfEnvelope } from "@rio.js/geo"
import { useGIS } from "@rio.js/gis/hooks/use-gis"
import { useProject } from "@rio.js/gis/store"
import { useIsMobile } from "@rio.js/ui/hooks/use-is-mobile"

import { expandBoundsForFocus } from "../../trafficure.core/utils/expand-bounds"
import type { Road } from "../roads-data"
import { fetchRoadGeometry } from "./use-road-geometry"

// Helper to calculate snap point height in pixels (mirrors alerts focus behavior)
function getSnapPointHeight(activeSnapPoint: number | string): number {
  if (typeof activeSnapPoint === "string") {
    return parseInt(activeSnapPoint, 10) || 0
  }
  // If it's a decimal (e.g., 0.7), multiply by viewport height
  return activeSnapPoint * window.innerHeight
}

/**
 * Centers and zooms the map on a given road geometry.
 * Intended to be used from the analytics road-detail route when a road is selected.
 */
export function useRoadFocus(road: Road | undefined) {
  const gis = useGIS()
  const isMobile = useIsMobile()
  const project = useProject()

  // Get snap point state (only relevant on mobile when using a bottom drawer)
  const [snapState] = useAppState<{
    snapPoints: (number | string)[]
    activeSnapPoint: number | string
  }>("main-drawer.snap-points", {
    snapPoints: ["56px", 1],
    activeSnapPoint: 1,
  })

  useEffect(() => {
    if (!road) return

    let cancelled = false

    const run = async () => {
      // When list has no geometry (include_geometry=false), fetch by road_id from traffic_segments_for_tiles
      const coordinates = road.geom?.coordinates?.length
        ? road.geom.coordinates
        : null
      const geom = coordinates
        ? { type: "LineString" as const, coordinates }
        : await fetchRoadGeometry(road.road_id)
      if (cancelled || !geom?.coordinates?.length) return

      const snapPointHeight = isMobile
        ? getSnapPointHeight(snapState.activeSnapPoint)
        : 0

      try {
        const feature = {
          type: "Feature" as const,
          geometry: {
            type: "LineString" as const,
            coordinates: geom.coordinates,
          },
          properties: { id: road.road_id },
        }

        const featureCollection = {
          type: "FeatureCollection" as const,
          features: [feature],
        }

        const envelope = turfEnvelope(featureCollection as any)
        const rawBounds: [[number, number], [number, number]] = [
          [envelope.bbox[0], envelope.bbox[1]],
          [envelope.bbox[2], envelope.bbox[3]],
        ]
        const bounds = expandBoundsForFocus(rawBounds)

        const mapStore = gis.getMapStore("main")
        const size = mapStore.getState().size

        const width = isMobile
          ? window.innerWidth
          : size.width || window.innerWidth
        const height = isMobile
          ? window.innerHeight
          : size.height || window.innerHeight

        const maxBottomPadding = Math.max(0, height - 100)
        const bottomPadding = Math.min(snapPointHeight, maxBottomPadding)

        const viewState = fitBounds({
          bounds,
          width,
          height,
          padding: {
            top: 50,
            bottom: bottomPadding + 40,
            left: 50,
            right: 50,
          },
          maxZoom: 15,
        })

        gis.project.setViewStateRow("main", viewState)

        if (project && !cancelled) {
          const selectedFeature = {
            type: "Feature" as const,
            geometry: {
              type: "LineString" as const,
              coordinates: geom.coordinates,
            },
            properties: {
              road_id: road.road_id,
              road_name: road.road_name,
              delay_percent: String(road.delay_percent ?? 0),
              traffic_status: road.traffic_status,
              current_travel_time_sec: road.current_travel_time_sec,
              freeflow_travel_time_sec: road.freeflow_travel_time_sec,
              baseline_travel_time_sec: road.baseline_travel_time_sec,
              delay_seconds: road.delay_seconds,
              delay_minutes: road.delay_minutes,
              road_length_meters: road.road_length_meters,
              current_speed_kmph: String(road.current_speed_kmph ?? 0),
              traffic_event_time: road.traffic_event_time ?? "",
              layerName: "traffic",
            },
          }

          project.setSelectedObjectRow("0", {
            layerId: "traffic",
            itemIndex: 0,
            selected: JSON.stringify(selectedFeature),
            itemType: "traffic_segment",
          })
        }
      } catch (error) {
        if (!cancelled) console.error("Error focusing on road:", error)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [road, gis, isMobile, snapState.activeSnapPoint, project])
}
