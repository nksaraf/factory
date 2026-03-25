import { useCallback, useEffect, useMemo, useState } from "react"

import { useCurrentOrganization } from "@rio.js/auth-ui/hooks/use-current-organization"
import { useRio } from "@rio.js/client"
import { fitBounds, envelope as turfEnvelope } from "@rio.js/geo"
import { useLayerStyle } from "@rio.js/gis/hooks/use-layers"
import { useSelectedObject } from "@rio.js/gis/hooks/use-selected-object"
import { useMapsRow, useProject } from "@rio.js/gis/store"
import { MapLayer } from "@rio.js/maps-ui/components/map-layer"
import { useMap } from "@rio.js/maps-ui/hooks/use-map"
import { MVTLayer } from "@rio.js/maps-ui/lib/deck-gl/geo-layers"

import { RoadHealthTooltip } from "./road-health-tooltip"
import TrafficRoadHighlightLayer from "./traffic-road-highlight-layer"
import {
  type TrafficRoadProperties,
  getArrowSizeForZoom,
  getTrafficColorBySeconds,
} from "./traffic-utils"

interface TrafficLayerProps {
  layerId?: string
  onLoad?: () => void
  onError?: (error: Error) => void
}

interface TrafficLayerProps {
  layerId?: string
}

export default function TrafficLayer({
  layerId = "traffic-segments",
}: TrafficLayerProps) {
  const rio = useRio()
  const project = useProject()
  const mapRow = useMapsRow("main")
  const mapStyle = mapRow?.style
  const isLightBaseMap = Boolean(
    mapStyle && mapStyle.toLowerCase().includes("light")
  )

  // Read interaction flags from layer style (defaults to false)
  const [layerStyle] = useLayerStyle(layerId)
  console.log("traffic-layer: layerStyle:", layerStyle)
  const canHover = layerStyle?.canHover ?? false
  const canClick = layerStyle?.canClick ?? false

  const highlightBorderColor: [number, number, number, number] = isLightBaseMap
    ? [60, 65, 67, 200]
    : [255, 255, 255, 255]
  const setHoverInfo = useMap((map) => map.setHoverInfo) as any
  const size = useMap((map) => map.size)
  const zoom = useMap((map) => map.viewState.zoom)

  const { data: activeOrganization } = useCurrentOrganization()
  const activeOrgId = activeOrganization?.id

  // Get selected object from reactive store
  const [selectedObject] = useSelectedObject()

  // Track hovered road
  const [hoveredRoad, setHoveredRoad] = useState<{
    path: number[][]
    properties: TrafficRoadProperties
  } | null>(null)

  // Refresh timestamp for periodic tile refresh (every 1 minute)
  const [refreshTimestamp, setRefreshTimestamp] = useState(Date.now())

  // Extract selected road from selectedObject
  const selectedRoad = useMemo(() => {
    if (selectedObject && selectedObject.properties) {
      return {
        geometry: selectedObject.geometry,
        properties: selectedObject.properties as TrafficRoadProperties,
      }
    }
    return null
  }, [selectedObject])

  // Handle road selection
  const handleMvtClick = useCallback(
    (info: any) => {
      if (!info.object || !project || !canClick) return

      console.log("traffic-layer: handleMvtClick called with info:", info)

      console.log("traffic-layer: info.object:", info.object)

      const properties = info.object.properties as TrafficRoadProperties
      const geometry = info.object.geometry

      console.log("traffic-layer: properties:", properties)
      console.log("traffic-layer: geometry:", geometry)

      // Create feature for bounds calculation
      const feature = {
        type: "Feature" as const,
        geometry: {
          type: "LineString",
          coordinates: geometry.coordinates,
        },
        properties,
      }

      console.log("traffic-layer: feature:", JSON.stringify(feature))

      const featureCollection = {
        type: "FeatureCollection" as const,
        features: [feature],
      }

      try {
        // Calculate bounds and navigate
        const envelope = turfEnvelope(featureCollection as any)
        const bounds: [[number, number], [number, number]] = [
          [envelope.bbox[0], envelope.bbox[1]], // [minLng, minLat]
          [envelope.bbox[2], envelope.bbox[3]], // [maxLng, maxLat]
        ]

        const viewState = fitBounds({
          bounds,
          width: size.width,
          height: size.height,
          padding: {
            top: 50,
            bottom: 40,
            left: 50,
            right: 50,
          },
          maxZoom: 15,
        })

        // Navigate to the road (transition handled by map component)
        project.setViewStateRow("main", viewState)

        // Store in selectedObject table
        project.setSelectedObjectRow("0", {
          layerId: layerId,
          itemIndex: 0, // MVT doesn't have index, use 0
          selected: JSON.stringify(feature),
          itemType: "traffic_segment",
        })

        // Emit event
        rio.events.emit("object.click", {
          type: "traffic_segment",
          object: feature,
        })
      } catch (error) {
        console.error("Error selecting road:", error)
      }
    },
    [project, layerId, size, rio, canClick]
  )

  // Periodic refresh every 1 minute to fetch fresh traffic data
  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshTimestamp(Date.now())
    }, 60000) // 1 minute = 60000ms

    return () => clearInterval(interval as any)
  }, [])

  // Tooltip handler using onHover
  const handleMvtHover = useCallback(
    (info: any) => {
      if (!canHover) {
        setHoveredRoad(null)
        setHoverInfo(null)
        return
      }
      if (info.object) {
        const properties = info.object.properties as TrafficRoadProperties
        const geometry = info.object.geometry

        console.log("traffic-layer: info:", info)

        // Extract path for hover layer
        if (geometry.type === "LineString" && geometry.coordinates) {
          setHoveredRoad({
            path: geometry.coordinates,
            properties,
          })
        }

        // Show tooltip
        setHoverInfo(
          <RoadHealthTooltip properties={properties} x={info.x} y={info.y} />
        )
      } else {
        setHoveredRoad(null)
        setHoverInfo(null)
      }
    },
    [setHoverInfo, canHover]
  )

  // Extract path coordinates from selected road
  const selectedPath = useMemo(() => {
    if (!selectedRoad?.geometry) {
      console.log("traffic-layer: No geometry in selectedRoad", selectedRoad)
      return null
    }

    // Handle both LineString and MultiLineString
    if (selectedRoad.geometry.type === "LineString") {
      const path = selectedRoad.geometry.coordinates
      console.log(
        "traffic-layer: Extracted selectedPath",
        path?.length,
        "points",
        "first point:",
        path?.[0]
      )

      // Validate coordinates format: should be [[lng, lat], [lng, lat], ...]
      if (!path || !Array.isArray(path) || path.length === 0) {
        console.error("traffic-layer: Invalid path format", path)
        return null
      }

      // Check if first coordinate is valid
      if (!Array.isArray(path[0]) || path[0].length < 2) {
        console.error("traffic-layer: Invalid coordinate format", path[0])
        return null
      }

      return path
    }

    // Handle MultiLineString - flatten to single path or use first line
    if (selectedRoad.geometry.type === "MultiLineString") {
      const coordinates = selectedRoad.geometry.coordinates
      console.log(
        "traffic-layer: MultiLineString detected, lines:",
        coordinates.length
      )
      // Use the first line string or flatten all
      const path = coordinates[0] // Or flatten all: coordinates.flat()
      return path
    }

    console.log(
      "traffic-layer: Geometry type is not LineString or MultiLineString",
      selectedRoad.geometry.type
    )
    return null
  }, [selectedRoad])

  // Extract path coordinates from hovered road
  const hoveredPath = useMemo(() => {
    return hoveredRoad?.path || null
  }, [hoveredRoad])

  // Note: We use fixed white color for selected road border, so no need for selectedRoadColor

  // Get colors for hovered road
  const hoveredRoadColor = useMemo(() => {
    if (!hoveredRoad) return null
    const delaySeconds =
      hoveredRoad.properties.current_travel_time_sec -
      (hoveredRoad.properties.baseline_travel_time_sec ||
        hoveredRoad.properties.freeflow_travel_time_sec ||
        0)
    return getTrafficColorBySeconds(delaySeconds, mapStyle)
  }, [hoveredRoad, mapStyle])

  // Arrow size calculation
  const arrowSize = useMemo(() => {
    return getArrowSizeForZoom(zoom, 8) // Base line width is 8px for core
  }, [zoom])

  return (
    <>
      {/* Base MVTLayer with traffic visualization */}
      <MapLayer
        type={MVTLayer}
        id={layerId}
        data={`https://api.traffic.management.tiler.rio.software/public.traffic_segments_for_tiles/{z}/{x}/{y}.pbf?filter=(organization_id='${activeOrgId}')&refresh=${refreshTimestamp}`}
        // data={`https://api.traffic.management.tiler.rio.software/public.traffic_segments_for_tiles/{z}/{x}/{y}.pbf?filter=(organization_id='${activeOrgId}')`}
        maxZoom={24}
        minZoom={0}
        maxCacheSize={0}
        picking={canHover || canClick} // Only enable picking if interactions are enabled
        onHover={canHover ? handleMvtHover : undefined}
        onClick={canClick ? handleMvtClick : undefined}
        {...({ pickable: canHover || canClick } as any)}
        lineWidthUnits="pixels"
        getLineWidth={() => 3}
        autoHighlight={false} // We handle highlighting ourselves
        lineCapRounded={false}
        lineJoinRounded={false}
        getLineColor={(d: any) => {
          const delaySeconds =
            d.properties.current_travel_time_sec -
            (d.properties.baseline_travel_time_sec ||
              d.properties.freeflow_travel_time_sec ||
              0)
          return getTrafficColorBySeconds(delaySeconds, mapStyle)
        }}
        uniqueIdProperty="segment_id"
        updateTriggers={{
          getTileData: {
            refresh: refreshTimestamp, // Forces tile refetch when timestamp changes
          },
          getLineColor: [refreshTimestamp], // Ensures colors are recalculated
        }}
      />

      {/* Selected Road - White border with glow effect for visibility */}
      {selectedPath && (
        <MapLayer
          type={TrafficRoadHighlightLayer}
          id="selected-road"
          data={[{ path: selectedPath }]}
          getPath={(d: { path: number[][] }) => d.path}
          borderColor={highlightBorderColor}
          coreColor={() => {
            const delaySeconds =
              (selectedRoad?.properties?.current_travel_time_sec || 0) -
              (selectedRoad?.properties?.baseline_travel_time_sec ||
                selectedRoad?.properties?.freeflow_travel_time_sec ||
                0)
            return getTrafficColorBySeconds(delaySeconds, mapStyle)
          }}
          borderWidth={8}
          coreWidth={5}
          borderWidthMinPixels={8}
          borderWidthMaxPixels={8}
          coreWidthMinPixels={5}
          coreWidthMaxPixels={5}
          arrowLength={arrowSize?.arrowLength || null}
          showGlow={false}
          rounded={false}
        />
      )}

      {/* Hovered Road - Thin, sharp (Google-style) */}
      {hoveredPath && hoveredRoadColor && (
        <MapLayer
          type={TrafficRoadHighlightLayer}
          id="hovered-road"
          data={[{ path: hoveredPath }]}
          getPath={(d: { path: number[][] }) => d.path}
          borderColor={highlightBorderColor}
          coreColor={hoveredRoadColor}
          borderWidth={8}
          coreWidth={5}
          borderWidthMinPixels={8}
          borderWidthMaxPixels={8}
          coreWidthMinPixels={5}
          coreWidthMaxPixels={5}
          arrowLength={arrowSize?.arrowLength || null}
          showGlow={false}
          rounded={false}
        />
      )}

      {/* Selected Road Panel */}
      {/* {selectedRoad && (
        <Panel
          id="selected-road-card"
          group="right-floating"
          {...({
            resizable: false,
            defaultSize: 100,
            minSize: 100,
            maxSize: 300,
          } as any)}
        >
          <TrafficRoadCard
            properties={selectedRoad.properties}
            onClose={() => {
              if (project) {
                project.delSelectedObjectRow("0")
              }
            }}
          />
        </Panel>
      )} */}
    </>
  )
}
