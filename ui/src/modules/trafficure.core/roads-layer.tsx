import {
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { useCurrentOrganization } from "@rio.js/auth-ui/hooks/use-current-organization"
import { useRio } from "@rio.js/client"
import { useLayerStyle } from "@rio.js/gis/hooks/use-layers"
import { useSelectedObject } from "@rio.js/gis/hooks/use-selected-object"
import { useMapsRow, useProject } from "@rio.js/gis/store"
import { MapLayer } from "@rio.js/maps-ui/components/map-layer"
import { useMap } from "@rio.js/maps-ui/hooks/use-map"
import { WebMercatorViewport } from "@rio.js/maps-ui/lib/deck-gl/core"
import { MVTLayer } from "@rio.js/maps-ui/lib/deck-gl/geo-layers"
import { useIsMobile } from "@rio.js/ui/hooks/use-is-mobile"

import { RoadsQueryContext } from "../trafficure.analytics/components/roads-query-context"
import {
  fetchRoadGeometry,
  fetchRoadsGeometry,
} from "../trafficure.analytics/data/use-road-geometry"
import {
  type RoadsSort,
  useRoadsQuery,
} from "../trafficure.analytics/data/use-roads-query"
import type { Road } from "../trafficure.analytics/roads-data"
import { RoadTooltip } from "./road-tooltip"
import TrafficRoadHighlightLayer from "./traffic-road-highlight-layer"
import {
  type TrafficRoadProperties,
  getDelaySecondsForColor,
  getTrafficBorderColorBySeconds,
  getTrafficColorBySeconds,
} from "./traffic-utils"

interface RoadsLayerProps {
  layerId?: string
  onLoad?: () => void
  onError?: (error: Error) => void
}

interface RoadsLayerProps {
  layerId?: string
}

export default function RoadsLayer({
  layerId = "traffic-segments",
}: RoadsLayerProps) {
  const rio = useRio()
  const project = useProject()
  const mapRow = useMapsRow("main")
  const mapStyle = mapRow?.style

  // Read interaction flags from layer style (defaults to false)
  const [layerStyle] = useLayerStyle(layerId)
  console.log("roads-layer: layerStyle:", layerStyle)
  const canHover = layerStyle?.canHover ?? false
  const canClick = layerStyle?.canClick ?? false

  const highlightBorderColor: [number, number, number, number] = [0, 0, 0, 255] // Black for hover/select (match alerts)
  const setHoverInfo = useMap((map) => map.setHoverInfo) as any
  const size = useMap((map) => map.size)
  const viewState = useMap((map) => map.viewState)

  const { data: activeOrganization } = useCurrentOrganization()
  const activeOrgId = activeOrganization?.id
  const isMobile = useIsMobile()

  // Get filters, sort, and count from roads query context (if available)
  // This context may not be available in non-analytics routes (like alerts)
  const roadsContext = useContext(RoadsQueryContext)
  const contextFilters = roadsContext?.filters || { searchTerm: "" }
  const contextSort = roadsContext?.sort || {
    key: "severity",
    sortOrder: "desc",
  }
  const count = roadsContext?.count || null
  const selectedQuestion = roadsContext?.selectedQuestion || null

  // When a question is selected, include relevant filters (timeScope or peakType) so map updates when filters change
  // When no question, use context filters/sort/count
  const effectiveFilters = (() => {
    if (
      selectedQuestion === "degrading_roads" ||
      selectedQuestion === "improving"
    ) {
      return { timeScope: contextFilters.timeScope || "this_week" }
    }
    if (selectedQuestion === "peak_hour") {
      return { peakType: contextFilters.peakType || "evening-peak" }
    }
    return selectedQuestion ? {} : contextFilters
  })()
  const effectiveSort = (
    selectedQuestion
      ? { key: "severity", sortOrder: "desc" as const }
      : contextSort
  ) as RoadsSort // Query will override with question's sort
  const effectiveCount = selectedQuestion ? null : count

  // Determine if we should use filtered roads (when count is set, question is selected, or filters are active)
  const hasActiveFilters =
    effectiveFilters.searchTerm && effectiveFilters.searchTerm.trim() !== ""
  const useFilteredRoads =
    effectiveCount !== null || selectedQuestion !== null || hasActiveFilters

  // Fetch filtered roads when filtering is active (query handles question automatically)
  const { roads: filteredRoads } = useRoadsQuery(
    effectiveFilters,
    effectiveSort,
    effectiveCount,
    selectedQuestion // Query automatically handles sort/filters/count based on question
  )

  // When filtering is active, fetch geometry for filtered roads from traffic_segments_for_tiles
  const [filteredRoadsWithGeometry, setFilteredRoadsWithGeometry] = useState<
    Road[]
  >([])

  useEffect(() => {
    if (!useFilteredRoads || !filteredRoads?.length) {
      setFilteredRoadsWithGeometry([])
      return
    }

    let cancelled = false
    const roadIds = filteredRoads.map((r) => r.road_id)

    fetchRoadsGeometry(roadIds).then((roadsWithGeom) => {
      if (cancelled) return
      setFilteredRoadsWithGeometry(roadsWithGeom)
    })

    return () => {
      cancelled = true
    }
  }, [useFilteredRoads, filteredRoads])

  // Get selected object from reactive store
  const [selectedObject] = useSelectedObject()

  // Track hovered road
  const [hoveredRoad, setHoveredRoad] = useState<{
    path: number[][]
    properties: TrafficRoadProperties
  } | null>(null)

  // Debounce hover updates from the map to avoid flicker when moving quickly
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // Pending hover from inbox when road has no geom: we fetch geometry by road_id
  const pendingHoverRoadIdRef = useRef<string | null>(null)
  const pendingHoverRoadRef = useRef<{
    road_id: string
    road_name: string
    delay_percent: number
    traffic_status: string
    current_speed_kmph: number
    traffic_event_time: string
    road_length_meters: number
    current_travel_time_sec: number
    freeflow_travel_time_sec: number
    baseline_travel_time_sec?: number
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
    async (info: any) => {
      if (!info.object || !project || !canClick) return

      console.log("roads-layer: handleMvtClick called with info:", info)
      console.log("roads-layer: info.object:", info.object)

      const properties = info.object.properties as TrafficRoadProperties
      const roadId = properties.road_id

      console.log("roads-layer: properties:", properties)

      try {
        // When clicking, clear any hover tooltip/highlight so only selection remains
        setHoveredRoad(null)
        setHoverInfo(null)
        rio.events.emit("road.hover", {
          type: "road",
          roadId: null,
          road: null,
          source: "map",
        })

        // Fetch full geometry from database for complete road highlight
        const fullGeometry = await fetchRoadGeometry(roadId)
        const geometry = fullGeometry || info.object.geometry

        console.log("roads-layer: geometry:", geometry)

        // Use delay and speed from roads list when available so selection color and details match inbox/card
        const roadFromList = filteredRoads?.find((r) => r.road_id === roadId)
        const propertiesWithDelay: TrafficRoadProperties = roadFromList
          ? {
              ...properties,
              delay_seconds: roadFromList.delay_seconds,
              delay_minutes: roadFromList.delay_minutes,
              current_speed_kmph: String(
                roadFromList.current_speed_kmph ?? properties.current_speed_kmph
              ),
            }
          : properties

        // Create feature with full geometry
        const feature = {
          type: "Feature" as const,
          geometry: {
            type: "LineString",
            coordinates: geometry.coordinates,
          },
          properties: propertiesWithDelay,
        }

        console.log("roads-layer: feature:", JSON.stringify(feature))

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
    [project, layerId, size, rio, canClick, setHoverInfo, filteredRoads]
  )

  // Periodic refresh every 1 minute to fetch fresh traffic data
  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshTimestamp(Date.now())
    }, 60000) // 1 minute = 60000ms

    return () => clearInterval(interval as any)
  }, [])

  // Handler for View Details button - selects the road
  const handleViewDetails = useCallback(
    (
      properties: TrafficRoadProperties,
      geometry?: { type: string; coordinates: number[][] }
    ) => {
      if (!project || !canClick) return

      try {
        // Create feature for selection
        const feature = {
          type: "Feature" as const,
          geometry: geometry || {
            type: "LineString" as const,
            coordinates: [] as number[][],
          },
          properties,
        }

        // Clear hover state
        setHoveredRoad(null)
        setHoverInfo(null)
        rio.events.emit("road.hover", {
          type: "road",
          roadId: null,
          road: null,
          source: "map",
        })

        // Store in selectedObject table
        project.setSelectedObjectRow("0", {
          layerId: layerId,
          itemIndex: 0,
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
    [project, layerId, rio, canClick, setHoverInfo]
  )

  // Tooltip handler using onHover
  const handleMvtHover = useCallback(
    (info: any) => {
      // When a road is explicitly selected, ignore hover so selection stays primary
      if (selectedRoad) {
        return
      }

      // Always clear any pending hover timeout before handling new hover state
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
        hoverTimeoutRef.current = null
      }

      if (!canHover) {
        setHoveredRoad(null)
        setHoverInfo(null)
        // Clear any hover sync when interactions are disabled
        rio.events.emit("road.hover", {
          type: "road",
          roadId: null,
          road: null,
          source: "map",
        })
        return
      }

      // When hovering over a road feature, debounce updating highlight + events
      if (info.object) {
        const properties = info.object.properties as TrafficRoadProperties
        const roadId = properties.road_id

        console.log("roads-layer: info:", info)

        hoverTimeoutRef.current = setTimeout(async () => {
          // Fetch full geometry from database instead of using partial MVT geometry
          const fullGeometry = await fetchRoadGeometry(roadId)
          const geometry = fullGeometry || info.object.geometry

          // Use delay and speed from roads list when available so hover color and tooltip match inbox/card
          const roadFromList = filteredRoads?.find((r) => r.road_id === roadId)
          const propertiesWithDelay: TrafficRoadProperties = roadFromList
            ? {
                ...properties,
                delay_seconds: roadFromList.delay_seconds,
                delay_minutes: roadFromList.delay_minutes,
                current_speed_kmph: String(
                  roadFromList.current_speed_kmph ??
                    properties.current_speed_kmph
                ),
              }
            : properties

          // Extract path for hover layer
          if (geometry.type === "LineString" && geometry.coordinates) {
            setHoveredRoad({
              path: geometry.coordinates,
              properties: propertiesWithDelay,
            })
          }

          // Change cursor to pointer on hover
          if (typeof document !== "undefined") {
            document.body.style.cursor = "pointer"
          }

          // Show tooltip with same properties as highlight (list delay/speed when available so tooltip matches inbox)
          setHoverInfo(
            isMobile ? null : (
              <Suspense fallback={null}>
                <RoadTooltip
                  properties={propertiesWithDelay}
                  x={info.x}
                  y={info.y}
                  onClose={() => {
                    setHoveredRoad(null)
                    setHoverInfo(null)
                    if (typeof document !== "undefined") {
                      document.body.style.cursor = ""
                    }
                    rio.events.emit("road.hover", {
                      type: "road",
                      roadId: null,
                      road: null,
                      source: "map",
                    })
                  }}
                  onViewDetails={() =>
                    handleViewDetails(propertiesWithDelay, geometry)
                  }
                />
              </Suspense>
            )
          )

          // Emit hover event so analytics inbox can synchronize hovered road
          // Mark with source="map" so inbox can ignore it (only selection should highlight)
          rio.events.emit("road.hover", {
            type: "road",
            roadId: properties.road_id,
            road: null,
            source: "map",
          })
        }, 80)
      } else {
        // When leaving a road / moving to empty space, debounce clearing so we
        // don't flicker when crossing gaps between segments.
        hoverTimeoutRef.current = setTimeout(() => {
          setHoveredRoad(null)
          setHoverInfo(null)

          // Reset cursor
          if (typeof document !== "undefined") {
            document.body.style.cursor = ""
          }

          // Emit hover clear event
          rio.events.emit("road.hover", {
            type: "road",
            roadId: null,
            road: null,
            source: "map",
          })
        }, 80)
      }
    },
    [
      setHoverInfo,
      canHover,
      rio,
      selectedRoad,
      isMobile,
      handleViewDetails,
      filteredRoads,
    ]
  )

  // Listen to hover events from the analytics inbox so hovering a road there
  // also highlights the corresponding segment on the map.
  useEffect(() => {
    const handleRoadHoverFromInbox = (event: {
      type: string
      roadId: string | null
      // We only care about road when coming from inbox; alerts/other emitters may send null
      road: {
        road_id: string
        road_name: string
        delay_percent: number
        traffic_status: string
        current_speed_kmph: number
        traffic_event_time: string
        road_length_meters: number
        current_travel_time_sec: number
        freeflow_travel_time_sec: number
        baseline_travel_time_sec?: number
        geom?: {
          coordinates: number[][]
        }
      } | null
    }) => {
      if (event.type !== "road") return

      // If a road is selected, ignore hover events so selection stays dominant
      if (selectedRoad) {
        return
      }

      // When inbox hover sends a full road with geometry, use it to drive highlight
      if (event.road && event.road.geom?.coordinates?.length) {
        const road = event.road
        const hovered = {
          path: road.geom.coordinates,
          properties: {
            road_id: road.road_id,
            road_name: road.road_name,
            delay_percent: String(road.delay_percent ?? 0),
            traffic_status: road.traffic_status,
            current_speed_kmph: String(road.current_speed_kmph ?? 0),
            traffic_event_time: road.traffic_event_time,
            road_length_meters: road.road_length_meters,
            current_travel_time_sec: road.current_travel_time_sec,
            freeflow_travel_time_sec: road.freeflow_travel_time_sec,
            baseline_travel_time_sec: road.baseline_travel_time_sec,
            delay_seconds: (road as { delay_seconds?: number }).delay_seconds,
            delay_minutes: (road as { delay_minutes?: number }).delay_minutes,
            layerName: "traffic",
          },
        }
        setHoveredRoad(hovered)

        // Also show the same tooltip used for map hover, positioned near the
        // middle of the road geometry on screen.
        const coords = road.geom.coordinates
        const midIndex = Math.floor(coords.length / 2)
        const [lng, lat] = coords[midIndex] || coords[0]
        const viewport = new WebMercatorViewport({
          ...viewState,
          width: size.width,
          height: size.height,
        })
        const [x, y] = viewport.project([lng, lat])

        setHoverInfo(
          isMobile ? null : (
            <Suspense fallback={null}>
              <RoadTooltip
                properties={hovered.properties}
                x={x}
                y={y}
                onClose={() => {
                  setHoveredRoad(null)
                  setHoverInfo(null)
                  rio.events.emit("road.hover", {
                    type: "road",
                    roadId: null,
                    road: null,
                    source: "map",
                  })
                }}
                onViewDetails={() =>
                  handleViewDetails(hovered.properties, {
                    type: "LineString",
                    coordinates: hovered.path,
                  })
                }
              />
            </Suspense>
          )
        )
      } else if (
        event.road &&
        event.road.road_id &&
        !event.road.geom?.coordinates?.length
      ) {
        // Road from list has no geometry (include_geometry=false); fetch geometry by road_id from traffic_segments_for_tiles
        const roadId = event.road.road_id
        pendingHoverRoadIdRef.current = roadId
        pendingHoverRoadRef.current = event.road
        fetchRoadGeometry(roadId).then((geom) => {
          const currentPendingId = pendingHoverRoadIdRef.current
          const road = pendingHoverRoadRef.current
          if (!geom || currentPendingId !== roadId || !road) return
          const hovered = {
            path: geom.coordinates,
            properties: {
              road_id: road.road_id,
              road_name: road.road_name,
              delay_percent: String(road.delay_percent ?? 0),
              traffic_status: road.traffic_status,
              current_speed_kmph: String(road.current_speed_kmph ?? 0),
              traffic_event_time: road.traffic_event_time,
              road_length_meters: road.road_length_meters,
              current_travel_time_sec: road.current_travel_time_sec,
              freeflow_travel_time_sec: road.freeflow_travel_time_sec,
              baseline_travel_time_sec: road.baseline_travel_time_sec,
              delay_seconds: (road as { delay_seconds?: number }).delay_seconds,
              delay_minutes: (road as { delay_minutes?: number }).delay_minutes,
              layerName: "traffic",
            },
          }
          setHoveredRoad(hovered)
          const coords = geom.coordinates
          const midIndex = Math.floor(coords.length / 2)
          const [lng, lat] = coords[midIndex] || coords[0]
          const viewport = new WebMercatorViewport({
            ...viewState,
            width: size.width,
            height: size.height,
          })
          const [x, y] = viewport.project([lng, lat])
          setHoverInfo(
            isMobile ? null : (
              <Suspense fallback={null}>
                <RoadTooltip
                  properties={hovered.properties}
                  x={x}
                  y={y}
                  onClose={() => {
                    setHoveredRoad(null)
                    setHoverInfo(null)
                    pendingHoverRoadIdRef.current = null
                    pendingHoverRoadRef.current = null
                    rio.events.emit("road.hover", {
                      type: "road",
                      roadId: null,
                      road: null,
                      source: "map",
                    })
                  }}
                  onViewDetails={() =>
                    handleViewDetails(hovered.properties, {
                      type: "LineString",
                      coordinates: hovered.path,
                    })
                  }
                />
              </Suspense>
            )
          )
        })
      } else if (!event.roadId) {
        // Clear hover when inbox sends a clear event
        pendingHoverRoadIdRef.current = null
        pendingHoverRoadRef.current = null
        setHoveredRoad(null)
        setHoverInfo(null)
      }
    }

    rio.events.on("road.hover", handleRoadHoverFromInbox)
    return () => {
      rio.events.off("road.hover", handleRoadHoverFromInbox)
    }
  }, [
    rio,
    selectedRoad,
    setHoverInfo,
    viewState,
    size.width,
    size.height,
    isMobile,
  ])

  // Clear any pending hover timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
      }
    }
  }, [])

  // Extract path coordinates from selected road
  const selectedPath = useMemo(() => {
    if (!selectedRoad?.geometry) {
      console.log("roads-layer: No geometry in selectedRoad", selectedRoad)
      return null
    }

    // Handle both LineString and MultiLineString
    if (selectedRoad.geometry.type === "LineString") {
      const path = selectedRoad.geometry.coordinates
      console.log(
        "roads-layer: Extracted selectedPath",
        path?.length,
        "points",
        "first point:",
        path?.[0]
      )

      // Validate coordinates format: should be [[lng, lat], [lng, lat], ...]
      if (!path || !Array.isArray(path) || path.length === 0) {
        console.error("roads-layer: Invalid path format", path)
        return null
      }

      // Check if first coordinate is valid
      if (!Array.isArray(path[0]) || path[0].length < 2) {
        console.error("roads-layer: Invalid coordinate format", path[0])
        return null
      }

      return path
    }

    // Handle MultiLineString - flatten to single path or use first line
    if (selectedRoad.geometry.type === "MultiLineString") {
      const coordinates = selectedRoad.geometry.coordinates
      console.log(
        "roads-layer: MultiLineString detected, lines:",
        coordinates.length
      )
      // Use the first line string or flatten all
      const path = coordinates[0] // Or flatten all: coordinates.flat()
      return path
    }

    console.log(
      "roads-layer: Geometry type is not LineString or MultiLineString",
      selectedRoad.geometry.type
    )
    return null
  }, [selectedRoad])

  // Extract path coordinates from hovered road
  const hoveredPath = useMemo(() => {
    return hoveredRoad?.path || null
  }, [hoveredRoad])

  // Note: We use fixed white color for selected road border, so no need for selectedRoadColor

  // Get colors for hovered road - use delay from API/query when present so highlight matches road inbox
  const hoveredRoadColor = useMemo(() => {
    if (!hoveredRoad) return null
    const delaySeconds = getDelaySecondsForColor(hoveredRoad.properties)
    return getTrafficColorBySeconds(delaySeconds, mapStyle)
  }, [hoveredRoad, mapStyle])

  // Convert filtered roads with geometry to renderable format
  const filteredRoadsData = useMemo(() => {
    if (!useFilteredRoads || !filteredRoadsWithGeometry?.length) {
      return []
    }

    return filteredRoadsWithGeometry
      .map((road) => {
        const properties: TrafficRoadProperties = {
          road_id: road.road_id,
          road_name: road.road_name,
          delay_percent: String(road.delay_percent ?? 0),
          traffic_status: road.traffic_status,
          current_speed_kmph: String(road.current_speed_kmph ?? 0),
          traffic_event_time: road.traffic_event_time,
          road_length_meters: road.road_length_meters,
          current_travel_time_sec: road.current_travel_time_sec,
          freeflow_travel_time_sec: road.freeflow_travel_time_sec,
          baseline_travel_time_sec: road.baseline_travel_time_sec,
          delay_seconds: road.delay_seconds,
          delay_minutes: road.delay_minutes,
          layerName: "traffic",
        }

        return {
          path: road.geom?.coordinates || [],
          properties,
          road_id: road.road_id,
        }
      })
      .filter((road) => road.path.length > 0)
  }, [useFilteredRoads, filteredRoadsWithGeometry])

  // Separate hovered/selected and normal filtered roads
  const highlightedFilteredRoadIds = new Set(
    [
      hoveredRoad?.properties?.road_id,
      selectedRoad?.properties?.road_id,
    ].filter(Boolean) as string[]
  )

  const normalFilteredRoads = filteredRoadsData.filter(
    (d) => !highlightedFilteredRoadIds.has(d.road_id)
  )
  const highlightedFilteredRoads = filteredRoadsData.filter((d) =>
    highlightedFilteredRoadIds.has(d.road_id)
  )

  // Handle hover for filtered roads
  const handleFilteredRoadHover = useCallback(
    (info: any) => {
      if (selectedRoad) return

      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
        hoverTimeoutRef.current = null
      }

      if (!canHover) {
        setHoveredRoad(null)
        setHoverInfo(null)
        rio.events.emit("road.hover", {
          type: "road",
          roadId: null,
          road: null,
          source: "map",
        })
        return
      }

      if (info.object) {
        const roadData = info.object
        hoverTimeoutRef.current = setTimeout(() => {
          setHoveredRoad({
            path: roadData.path,
            properties: roadData.properties,
          })

          // Change cursor to pointer on hover
          if (typeof document !== "undefined") {
            document.body.style.cursor = "pointer"
          }

          setHoverInfo(
            isMobile ? null : (
              <Suspense fallback={null}>
                <RoadTooltip
                  properties={roadData.properties}
                  x={info.x}
                  y={info.y}
                  onClose={() => {
                    setHoveredRoad(null)
                    setHoverInfo(null)
                    if (typeof document !== "undefined") {
                      document.body.style.cursor = ""
                    }
                    rio.events.emit("road.hover", {
                      type: "road",
                      roadId: null,
                      road: null,
                      source: "map",
                    })
                  }}
                  onViewDetails={() =>
                    handleViewDetails(roadData.properties, {
                      type: "LineString",
                      coordinates: roadData.path,
                    })
                  }
                />
              </Suspense>
            )
          )

          rio.events.emit("road.hover", {
            type: "road",
            roadId: roadData.properties.road_id,
            road: null,
            source: "map",
          })
        }, 80)
      } else {
        hoverTimeoutRef.current = setTimeout(() => {
          setHoveredRoad(null)
          setHoverInfo(null)
          // Reset cursor
          if (typeof document !== "undefined") {
            document.body.style.cursor = ""
          }
          rio.events.emit("road.hover", {
            type: "road",
            roadId: null,
            road: null,
            source: "map",
          })
        }, 80)
      }
    },
    [setHoverInfo, canHover, rio, selectedRoad, isMobile, handleViewDetails]
  )

  // Handle click for filtered roads
  const handleFilteredRoadClick = useCallback(
    (info: any) => {
      if (!info.object || !project || !canClick) return

      const roadData = info.object
      const properties = roadData.properties
      const path = roadData.path

      try {
        setHoveredRoad(null)
        setHoverInfo(null)
        rio.events.emit("road.hover", {
          type: "road",
          roadId: null,
          road: null,
          source: "map",
        })

        const feature = {
          type: "Feature" as const,
          geometry: {
            type: "LineString" as const,
            coordinates: path,
          },
          properties,
        }

        project.setSelectedObjectRow("0", {
          layerId: layerId,
          itemIndex: 0,
          selected: JSON.stringify(feature),
          itemType: "traffic_segment",
        })

        rio.events.emit("object.click", {
          type: "traffic_segment",
          object: feature,
        })
      } catch (error) {
        console.error("Error selecting road:", error)
      }
    },
    [project, layerId, rio, canClick, setHoverInfo]
  )

  return (
    <>
      {useFilteredRoads && filteredRoadsData.length > 0 ? (
        <>
          {/* Filtered roads layer - render when filtering is active */}
          {normalFilteredRoads.length > 0 && (
            <MapLayer
              type={TrafficRoadHighlightLayer}
              id={`${layerId}-filtered-normal`}
              data={normalFilteredRoads}
              getPath={(d: (typeof filteredRoadsData)[0]) => d.path}
              borderColor={(d: (typeof filteredRoadsData)[0]) => {
                const delaySeconds = getDelaySecondsForColor(d.properties)
                return getTrafficBorderColorBySeconds(delaySeconds, mapStyle)
              }}
              coreColor={(d: (typeof filteredRoadsData)[0]) => {
                const delaySeconds = getDelaySecondsForColor(d.properties)
                return getTrafficColorBySeconds(delaySeconds, mapStyle)
              }}
              borderWidth={4}
              coreWidth={4}
              borderWidthMinPixels={4}
              borderWidthMaxPixels={4}
              coreWidthMinPixels={4}
              coreWidthMaxPixels={4}
              arrowLength={15}
              showGlow={false}
              rounded={false}
              pickable={canHover || canClick}
              onHover={canHover ? handleFilteredRoadHover : undefined}
              onClick={canClick ? handleFilteredRoadClick : undefined}
              updateTriggers={{
                getPath: [filteredRoadsData],
                borderColor: [filteredRoadsData, mapStyle],
                coreColor: [filteredRoadsData, mapStyle],
              }}
            />
          )}

          {highlightedFilteredRoads.length > 0 && (
            <MapLayer
              type={TrafficRoadHighlightLayer}
              id={`${layerId}-filtered-highlighted`}
              data={highlightedFilteredRoads}
              getPath={(d: (typeof filteredRoadsData)[0]) => d.path}
              borderColor={highlightBorderColor}
              coreColor={(d: (typeof filteredRoadsData)[0]) => {
                const delaySeconds = getDelaySecondsForColor(d.properties)
                return getTrafficColorBySeconds(delaySeconds, mapStyle)
              }}
              borderWidth={10}
              coreWidth={6}
              borderWidthMinPixels={10}
              borderWidthMaxPixels={10}
              coreWidthMinPixels={6}
              coreWidthMaxPixels={6}
              arrowLength={15}
              showGlow={false}
              rounded={false}
              pickable={canHover || canClick}
              onHover={canHover ? handleFilteredRoadHover : undefined}
              onClick={canClick ? handleFilteredRoadClick : undefined}
              updateTriggers={{
                getPath: [filteredRoadsData],
                coreColor: [filteredRoadsData, mapStyle],
              }}
            />
          )}
        </>
      ) : (
        <>
          {/* MVT tiles - render when no filtering or still loading geometry */}
          {/* Hit MVTLayer with thicker, transparent lines to make picking easier */}
          <MapLayer
            type={MVTLayer}
            id={`${layerId}-hit`}
            data={`https://api.traffic.management.tiler.rio.software/public.traffic_segments_for_tiles/{z}/{x}/{y}.pbf?filter=(organization_id='${activeOrgId}')&refresh=${refreshTimestamp}`}
            maxZoom={24}
            minZoom={0}
            maxCacheSize={0}
            picking={canHover || canClick}
            pickRadius={0}
            onHover={canHover ? handleMvtHover : undefined}
            onClick={canClick ? handleMvtClick : undefined}
            {...({ pickable: canHover || canClick } as any)}
            lineWidthUnits="pixels"
            getLineWidth={() => 10}
            autoHighlight={false}
            lineCapRounded={false}
            lineJoinRounded={false}
            getLineColor={() => [0, 0, 0, 0]}
            uniqueIdProperty="segment_id"
            updateTriggers={{
              getTileData: {
                refresh: refreshTimestamp,
              },
            }}
          />

          {/* Base MVTLayer with traffic visualization (no picking, just visual) */}
          <MapLayer
            type={MVTLayer}
            id={layerId}
            data={`https://api.traffic.management.tiler.rio.software/public.traffic_segments_for_tiles/{z}/{x}/{y}.pbf?filter=(organization_id='${activeOrgId}')&refresh=${refreshTimestamp}`}
            maxZoom={24}
            minZoom={0}
            maxCacheSize={0}
            picking={false}
            onHover={undefined}
            onClick={undefined}
            {...({ pickable: false } as any)}
            lineWidthUnits="pixels"
            getLineWidth={() => 3}
            autoHighlight={false}
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
                refresh: refreshTimestamp,
              },
              getLineColor: [refreshTimestamp],
            }}
          />
        </>
      )}

      {/* Selected Road - match alerts dimensions (10/6) with black border */}
      {selectedPath && (
        <MapLayer
          type={TrafficRoadHighlightLayer}
          id="selected-road"
          data={[{ path: selectedPath }]}
          getPath={(d: { path: number[][] }) => d.path}
          borderColor={highlightBorderColor}
          coreColor={() => {
            if (!selectedRoad?.properties)
              return [128, 128, 128, 255] as [number, number, number, number]
            const delaySeconds = getDelaySecondsForColor(
              selectedRoad.properties
            )
            return getTrafficColorBySeconds(delaySeconds, mapStyle)
          }}
          borderWidth={10}
          coreWidth={6}
          borderWidthMinPixels={10}
          borderWidthMaxPixels={10}
          coreWidthMinPixels={6}
          coreWidthMaxPixels={6}
          arrowLength={15}
          showGlow={false}
          rounded={false}
        />
      )}

      {/* Hovered Road - match alerts dimensions (10/6) with black border */}
      {hoveredPath && hoveredRoadColor && (
        <MapLayer
          type={TrafficRoadHighlightLayer}
          id="hovered-road"
          data={[{ path: hoveredPath }]}
          getPath={(d: { path: number[][] }) => d.path}
          borderColor={highlightBorderColor}
          coreColor={hoveredRoadColor}
          borderWidth={10}
          coreWidth={6}
          borderWidthMinPixels={10}
          borderWidthMaxPixels={10}
          coreWidthMinPixels={6}
          coreWidthMaxPixels={6}
          arrowLength={15}
          showGlow={false}
          rounded={false}
        />
      )}
    </>
  )
}
