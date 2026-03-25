import React, { useContext, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router"

import { useRio } from "@rio.js/client"
import { useLayerSource } from "@rio.js/gis/hooks/use-layers"
import { useMapsRow } from "@rio.js/gis/store"
import { MapLayer } from "@rio.js/maps-ui/components/map-layer"
import { useMap, useMapContext } from "@rio.js/maps-ui/hooks/use-map"
import { WebMercatorViewport } from "@rio.js/maps-ui/lib/deck-gl/core"
import { ViewState } from "@rio.js/maps-ui/lib/view-state"
import { Portkey } from "@rio.js/tunnel"
import { cn } from "@rio.js/ui/lib/utils"

import type { AlertTypeKey } from "./alert-type-config"
import { type Alert } from "./alerts-data"
import { AlertsQueryContext } from "./components/alerts-query-context"
import { useAlertsQuery } from "./data/alerts"
import { useHistoricalAlertsQuery } from "./data/historical-alerts"
import TrafficRoadHighlightLayer from "./traffic-road-highlight-layer"
import {
  getTrafficBorderColorBySeconds,
  getTrafficColorBySeconds,
  getTrafficStatusBySeconds,
} from "./traffic-utils"
import { formatDelay } from "./utils/format-number"

// Core colors for resolved/suppressed alerts by type (not delay-based)
const RESOLVED_ALERT_CORE_COLORS: Record<
  AlertTypeKey,
  [number, number, number, number]
> = {
  RAPID_DETERIORATION: [255, 205, 0, 255], // light yellow
  CONGESTION: [185, 55, 55, 255], // one shade lighter red
}

function getResolvedAlertCoreColor(
  alertType: AlertTypeKey | undefined
): [number, number, number, number] {
  if (alertType === "RAPID_DETERIORATION" || alertType === "CONGESTION") {
    return RESOLVED_ALERT_CORE_COLORS[alertType]
  }
  return RESOLVED_ALERT_CORE_COLORS.CONGESTION
}

export default function AlertsLayer({
  layerId,
  onLoad,
}: {
  layerId: string
  onLoad?: () => void
}) {
  const rio = useRio()
  const { alertId } = useParams()
  // const [hoveredAlert, setHoveredAlert] = useState<Alert | null>(null)
  const hoverInfo = useMap((map) => map.hoverInfo)
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null)
  const [hoveredAlertId, setHoveredAlertId] = useState<string | null>(null)

  const mapRow = useMapsRow("main")
  const mapStyle = mapRow?.style
  const isLightBaseMap = Boolean(
    mapStyle && mapStyle.toLowerCase().includes("light")
  )

  const highlightBorderColor: [number, number, number, number] = [0, 0, 0, 255] // Black for hover

  const navigate = useNavigate()

  // Get filters, sort, and count/timeRange from alerts query context (if available)
  // This context may not be available in non-alerts routes (like analytics)
  const alertsContext = useContext(AlertsQueryContext)
  const liveFilters = alertsContext?.liveFilters || {}
  const historicalFilters = alertsContext?.historicalFilters || {}
  const liveSort = alertsContext?.liveSort || {
    key: "delay_seconds",
    sortOrder: "desc",
  }
  const historicalSort = alertsContext?.historicalSort || {
    key: "resolved_at",
    sortOrder: "desc",
  }
  const liveCount = alertsContext?.liveCount || null
  const historicalTimeRange = alertsContext?.historicalTimeRange || "1h"

  const source = useLayerSource(layerId)

  // Fetch alerts from API (both live and historical) with filtering and sorting
  // Use the same filters/sort/count/timeRange as the inbox for consistency
  const { alerts: fetchedAlerts } = useAlertsQuery(
    liveFilters,
    liveSort as any,
    liveCount
  )
  const { alerts: historicalAlerts } = useHistoricalAlertsQuery(
    historicalFilters,
    historicalSort as any,
    historicalTimeRange
  )

  // Fallback query: fetch all live alerts (without count limit) to find selected alerts
  // that may be outside the current filter (e.g., Top 10 vs Top 20)
  const { alerts: allLiveAlertsFallback } = useAlertsQuery(
    liveFilters,
    liveSort as any,
    null
  )

  // Get alerts data - use fetched alerts, fallback to source if available
  // Only show live alerts on map by default, but include resolved alerts for selected alert lookup
  const alertsData = useMemo(() => {
    // Only show live alerts on the map
    let alerts: Alert[] = fetchedAlerts || []

    // If source has data, try to use it (for future extensibility)
    if (source?.type === "geojson" && source.data) {
      // Could transform GeoJSON features back to Alert format if needed
      // For now, use fetched alerts
    }

    return alerts.map((alert) => ({
      type: "Feature",
      geometry: alert.geometry,
      properties: {
        alert,
        id: alert.id,
      },
      position: alert.coordinates,
      alert,
      id: alert.id,
    }))
  }, [source, fetchedAlerts])

  // Get all alerts (live + resolved) for selected alert lookup
  // Include fallback live alerts to find alerts outside current count filter
  const allAlerts = useMemo(() => {
    return [...allLiveAlertsFallback, ...historicalAlerts]
  }, [allLiveAlertsFallback, historicalAlerts])

  // Keep a stable selected alert so map highlight/focus doesn't flicker
  // when alerts data refetches or when the "new alerts detected" toast appears.
  useEffect(() => {
    if (!alertId) {
      setSelectedAlert(null)
      return
    }

    const found = allAlerts.find((a) => a.id === alertId)

    // If we find an updated instance of the selected alert, sync it into local state.
    if (found) {
      setSelectedAlert(found)
    }
    // If not found (e.g. during a brief refetch), keep the previous selectedAlert
    // so that the map highlight and focus remain stable.
  }, [alertId, allAlerts])

  // Get hovered alert from map hover or from inbox hover event
  // Check allAlerts (live + resolved) to find hovered alert even if it's resolved
  const hoveredAlert =
    hoverInfo?.object?.alert ||
    (hoveredAlertId
      ? allAlerts.find((a) => a.id === hoveredAlertId) ||
        alertsData.find((d) => d.alert.id === hoveredAlertId)?.alert
      : null)

  // Always derive the final selected alert from stable local state
  const finalSelectedAlert = selectedAlert

  // If selected alert is not in current map data (resolved or live outside filter),
  // add it to the map data for rendering
  const selectedResolvedAlertData = useMemo(() => {
    if (
      finalSelectedAlert &&
      !alertsData.find((d) => d.alert.id === finalSelectedAlert.id)
    ) {
      // Include selected alert if it's resolved/suppressed OR if it's a live alert
      // that's outside the current count filter (e.g., Top 20 when filter is Top 10)
      const isResolved =
        finalSelectedAlert.type === "resolved" ||
        finalSelectedAlert.type === "suppressed"
      const isLiveOutsideFilter =
        finalSelectedAlert.type === "active" &&
        !fetchedAlerts.find((a) => a.id === finalSelectedAlert.id)

      if (isResolved || isLiveOutsideFilter) {
        return [
          {
            type: "Feature" as const,
            geometry: finalSelectedAlert.geometry,
            properties: {
              alert: finalSelectedAlert,
              id: finalSelectedAlert.id,
            },
            position: finalSelectedAlert.coordinates,
            alert: finalSelectedAlert,
            id: finalSelectedAlert.id,
          },
        ]
      }
    }
    return []
  }, [finalSelectedAlert, alertsData, fetchedAlerts])

  // Listen to hover events from the inbox
  useEffect(() => {
    const handleAlertHover = (event: {
      type: string
      alertId: string | null
      alert: Alert | null
    }) => {
      if (event.type === "alert") {
        setHoveredAlertId(event.alertId || null)
      }
    }

    rio.events.on("alert.hover", handleAlertHover)

    return () => {
      rio.events.off("alert.hover", handleAlertHover)
    }
  }, [rio])

  console.log("hoveredAlert", hoveredAlert)

  // Call onLoad when data is ready
  useEffect(() => {
    if (alertsData.length > 0 && onLoad) {
      onLoad()
    }
  }, [alertsData.length, onLoad])

  const zoom = useMap((map) => map.viewState.zoom)

  // Separate hovered/selected and normal alerts
  // Include resolved selected alert in the data
  const allAlertsData = [...alertsData, ...selectedResolvedAlertData]
  const highlightedAlertIds = new Set(
    [hoveredAlert?.id, finalSelectedAlert?.id].filter(Boolean) as string[]
  )

  const normalAlerts = allAlertsData.filter(
    (d) => !highlightedAlertIds.has(d.alert.id)
  )
  const highlightedAlerts = allAlertsData.filter((d) =>
    highlightedAlertIds.has(d.alert.id)
  )

  const hasSelectedAlert = Boolean(finalSelectedAlert)

  // For overlays: only show HTML overlay for active alerts
  // When an alert is selected, only show HTML overlay for that alert if it's active
  // If a resolved alert is selected, show no overlays (hide all active alerts)
  const overlayAlertsData = useMemo(() => {
    // Filter out resolved/suppressed alerts - only show active alerts in overlay
    const activeAlerts = allAlertsData.filter(
      (d) => d.alert.type === "active" || d.alert.type === undefined
    )

    if (hasSelectedAlert) {
      // Check if selected alert is active
      const selected = activeAlerts.find(
        (d) => d.alert.id === finalSelectedAlert?.id
      )

      if (selected) {
        // Selected alert is active - show only this alert
        return [selected]
      } else {
        // Selected alert is resolved/suppressed - hide all overlays
        return []
      }
    }

    return activeAlerts
  }, [allAlertsData, hasSelectedAlert, finalSelectedAlert?.id])

  return (
    <>
      <AlertsOverlayLayer
        alertsData={overlayAlertsData}
        hoveredAlert={hoveredAlert}
        selectedAlert={finalSelectedAlert}
        isLightBaseMap={isLightBaseMap}
        mapStyle={mapStyle}
      />
      {/* Render all normal routes (hidden when an alert is selected) */}
      {!hasSelectedAlert && normalAlerts.length > 0 && (
        <MapLayer
          type={TrafficRoadHighlightLayer}
          id="selected-road"
          data={normalAlerts}
          getPath={(d: (typeof allAlertsData)[0]) => d.geometry.coordinates}
          {...({
            borderColor: (
              d: (typeof allAlertsData)[0]
            ): [number, number, number, number] => {
              const delaySeconds = d.alert.impactCostSec
              return getTrafficBorderColorBySeconds(delaySeconds, mapStyle)
            },
          } as any)}
          {...({
            coreColor: (
              d: (typeof allAlertsData)[0]
            ): [number, number, number, number] => {
              const delaySeconds = d.alert.impactCostSec
              return getTrafficColorBySeconds(delaySeconds, mapStyle)
            },
          } as any)}
          borderWidth={4}
          coreWidth={4}
          borderWidthMinPixels={4}
          borderWidthMaxPixels={4}
          coreWidthMinPixels={4}
          coreWidthMaxPixels={4}
          arrowLength={15}
          showGlow={false}
          rounded={false}
          order={100}
          pickable
          onHover={(info) => {
            if (info.object) {
              const alert = info.object.alert
              // Emit hover event for inbox synchronization and highlight layer
              console.log("hovered from normal", alert)
              rio.events.emit("alert.hover", {
                type: "alert",
                alertId: alert.id,
                alert,
              })
              // Change cursor to pointer on hover
              if (typeof document !== "undefined") {
                document.body.style.cursor = "pointer"
              }
            } else {
              // Emit hover clear event
              rio.events.emit("alert.hover", {
                type: "alert",
                alertId: null,
                alert: null,
              })
              if (typeof document !== "undefined") {
                document.body.style.cursor = ""
              }
            }
          }}
          onClick={(info, event) => {
            console.log("onClick triggered - normal", {
              info,
              event,
              object: info.object,
            })
            // MapLayer wrapper already checks isLeftClick, so we can proceed directly
            if (info.object) {
              const alert = info.object.alert
              if (alert) {
                // Set flag to prevent map click from firing
                if (typeof window !== "undefined") {
                  window.featureClicked = true
                }
                // Emit click event
                console.log("clicked from normal", alert)
                rio.events.emit("object.click", {
                  type: "alert",
                  object: alert,
                })
                // Navigate to alert detail page
                navigate(`/alerts/${alert.id}`)
              } else {
                console.warn("Alert not found in object", info.object)
              }
            } else {
              console.warn("No object in click info", info)
            }
          }}
          updateTriggers={{
            getFillColor: [
              hoveredAlert?.id,
              finalSelectedAlert?.id,
              hoveredAlertId,
            ],
            getRadius: [zoom],
          }}
        />
      )}
      {/* Render hovered/selected routes with highlighted color and scaled up */}
      {highlightedAlerts.length > 0 && (
        <MapLayer
          type={TrafficRoadHighlightLayer}
          id="selected-road-hovered"
          data={highlightedAlerts}
          getPath={(d: (typeof allAlertsData)[0]) => d.geometry.coordinates}
          borderColor={highlightBorderColor}
          coreColor={(
            d: (typeof allAlertsData)[0]
          ): [number, number, number, number] => {
            const isResolved =
              d.alert.type === "resolved" || d.alert.type === "suppressed"
            if (isResolved) {
              return getResolvedAlertCoreColor(d.alert.alertType)
            }
            return getTrafficColorBySeconds(d.alert.impactCostSec, mapStyle)
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
          order={999}
          pickable
          onHover={(info) => {
            if (info.object) {
              const alert = info.object.alert
              // Emit hover event for inbox synchronization and highlight layer
              rio.events.emit("alert.hover", {
                type: "alert",
                alertId: alert.id,
                alert,
              })
              // Change cursor to pointer on hover
              if (typeof document !== "undefined") {
                document.body.style.cursor = "pointer"
              }
            } else {
              // Emit hover clear event
              rio.events.emit("alert.hover", {
                type: "alert",
                alertId: null,
                alert: null,
              })
              if (typeof document !== "undefined") {
                document.body.style.cursor = ""
              }
            }
          }}
          onClick={(info, event) => {
            console.log("onClick triggered - highlighted", {
              info,
              event,
              object: info.object,
            })
            // MapLayer wrapper already checks isLeftClick, so we can proceed directly
            if (info.object) {
              const alert = info.object.alert
              if (alert) {
                // Set flag to prevent map click from firing
                if (typeof window !== "undefined") {
                  window.featureClicked = true
                }
                // Emit click event
                console.log("clicked from highlighted", alert)
                rio.events.emit("object.click", {
                  type: "alert",
                  object: alert,
                })
                // Navigate to alert detail page
                navigate(`/alerts/${alert.id}`)
              } else {
                console.warn("Alert not found in object", info.object)
              }
            } else {
              console.warn("No object in click info", info)
            }
          }}
          updateTriggers={{
            getFillColor: [
              hoveredAlert?.id,
              finalSelectedAlert?.id,
              hoveredAlertId,
            ],
            getRadius: [zoom],
          }}
        />
      )}
      {/* <MapLayer
        id="alerts-layer"
        data={alertsData}
        type={GeoJsonLayer}
        pointType="circle"
        autoHighlight
        pickable
        highlightColor={[255, 255, 0, 200]}
        pointRadiusScale={20}
        pointRadiusMinPixels={6}
        pointRadiusMaxPixels={25}
        lineWidthMinPixels={2}
        lineWidthMaxPixels={4}
        stroked
        filled
        getPointRadius={(d) => {
          const baseSize = alertTypeSizes[d.alert.alertType]
          // Scale size based on zoom level for better visibility
          const zoomFactor = Math.max(0.8, Math.min(1.5, (zoom || 12) / 12))
          return baseSize * zoomFactor
        }}
        getFillColor={(d) => {
          const baseColor = alertTypeColors[d.alert.alertType]
          // Make hovered/selected alerts brighter and slightly larger
          const isHovered =
            hoveredAlert?.id === d.alert.id || hoveredAlertId === d.alert.id
          const isSelected = selectedAlert?.id === d.alert.id
          if (isHovered || isSelected) {
            return [baseColor[0], baseColor[1], baseColor[2], 255]
          }
          // Slightly transparent for non-hovered alerts
          return [baseColor[0], baseColor[1], baseColor[2], 220]
        }}
        getLineColor={(d) => {
          const baseColor = alertTypeColors[d.alert.alertType]
          // Darker outline for contrast
          return [
            Math.max(0, baseColor[0] - 40),
            Math.max(0, baseColor[1] - 40),
            Math.max(0, baseColor[2] - 40),
            255,
          ]
        }}
        getLineWidth={(d) => {
          // Thicker outline for CONGESTION alerts
          return d.alert.alertType === "CONGESTION" ? 3 : 2
        }}
        onHover={(info) => {
          if (info.object) {
            setHoverInfo(
              <div
                className="bg-card text-card-foreground absolute z-[99999] rounded-md p-2 text-base"
                style={{
                  left: info.x + 8,
                  top: info.y + 8,
                }}
              >
                <div>
                  <div className="text-brand-600 text-base font-normal">
                    {info.object.alert.location}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {alertTypeLabels[info.object.alert.alertType]} •{" "}
                    {info.object.alert.severity} severity
                  </div>
                </div>
              </div>
            )
            // Emit hover event for inbox synchronization
            rio.events.emit("alert.hover", {
              type: "alert",
              alertId: info.object.alert.id,
              alert: info.object.alert,
            })
            // Change cursor to pointer on hover
            if (info.object && typeof document !== "undefined") {
              document.body.style.cursor = "pointer"
            }
          } else {
            setHoverInfo(null)
            // Emit hover clear event
            rio.events.emit("alert.hover", {
              type: "alert",
              alertId: null,
              alert: null,
            })
            if (typeof document !== "undefined") {
              document.body.style.cursor = ""
            }
          }
        }}
        onClick={(info) => {
          console.log(info)
          if (info.object) {
            setSelectedAlert(info.object.alert)
            // Navigate to alert detail page
            if (typeof window !== "undefined") {
              window.location.href = `/alerts/${info.object.alert.id}`
            }
          }
        }}
        updateTriggers={{
          getFillColor: [hoveredAlert?.id, selectedAlert?.id, hoveredAlertId],
          getRadius: [zoom],
        }}
      /> */}
    </>
  )
}

function AlertsOverlayLayer({
  alertsData,
  hoveredAlert,
  selectedAlert,
  isLightBaseMap,
  mapStyle,
}: {
  alertsData: Array<{ position: [number, number]; alert: Alert; id: string }>
  hoveredAlert: Alert | null
  selectedAlert?: Alert | null
  isLightBaseMap: boolean
  mapStyle?: string | null
}) {
  const rio = useRio()
  const mapContext = useMapContext()
  const [viewState, setViewState] = useState(mapContext.getState().viewState)
  const eventTarget = useMap((map) => map.eventTarget)
  const size = useMap((map) => map.size)

  // Throttle viewport updates to reduce recalculations (especially important on mobile)
  useEffect(() => {
    let rafId: number | null = null
    let pendingViewState: ViewState | null = null

    function onViewStateChange(event: CustomEvent<{ viewState: ViewState }>) {
      pendingViewState = event.detail.viewState
      
      // Use requestAnimationFrame to throttle updates to once per frame
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          if (pendingViewState) {
            setViewState(pendingViewState)
          }
          rafId = null
          pendingViewState = null
        })
      }
    }
    
    eventTarget.addEventListener("view-state-change", onViewStateChange)
    return () => {
      eventTarget.removeEventListener("view-state-change", onViewStateChange)
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [eventTarget])

  const viewport = useMemo(
    () =>
      new WebMercatorViewport({
        ...viewState,
        height: size.height,
        width: size.width,
      }),
    [viewState, size.height, size.width]
  )

  const navigate = useNavigate()

  type ProjectedAlert = {
    id: string
    alert: Alert
    x: number
    y: number
    bucketKey: string
  }

  const grouped = useMemo(() => {
    const map = new Map<string, ProjectedAlert[]>()

    for (const alertData of alertsData) {
      const alert = alertData.alert
      const [x, y] = viewport.project(alertData.position)
      // Group by approximate geographic coordinates so pills stack only
      // when they truly share (almost) the same position. If they are not
      // near enough in terms of coordinates, let them overlap.
      const [lng, lat] = alertData.position
      const bucketKey = `${lng.toFixed(5)}:${lat.toFixed(5)}`

      const arr = map.get(bucketKey) ?? []
      arr.push({ id: alertData.id, alert, x, y, bucketKey })
      map.set(bucketKey, arr)
    }

    return [...map.entries()]
  }, [alertsData, viewport])

  function getStackOffsetPx(count: number, index: number) {
    if (count <= 1) return { dx: 0, dy: 0 }

    // Compact circles: small vertical offset when stacked
    // Using smaller default circle size (24px)
    const circleSize = 24
    const gap = 4
    const totalOffset = (circleSize + gap) * index
    return { dx: 0, dy: -totalOffset }
  }

  // Memoize circle rendering to reduce recalculations on mobile
  const CircleOverlay = useMemo(
    () =>
      React.memo(
        ({
          projectedAlert,
          offset,
          zIndex,
          isHovered,
          isSelected,
        }: {
          projectedAlert: ProjectedAlert
          offset: { dx: number; dy: number }
          zIndex: number
          isHovered: boolean
          isSelected: boolean
        }) => {
          const alert = projectedAlert.alert
          const isHighlighted = isHovered || isSelected

          // Memoize expensive calculations
          const delaySeconds = alert.impactCostSec
          const roadColor = getTrafficColorBySeconds(
            delaySeconds,
            mapStyle ?? undefined
          )
          const timeDisplay = formatDelay(alert.impactCostSec)

          const borderClass = isLightBaseMap
            ? "border-2 border-slate-800"
            : "border-2 border-white"

          // Smaller circle by default, bigger when highlighted
          const circleSize = isHighlighted
            ? "w-[32px] h-[32px]"
            : "w-[24px] h-[24px]"
          const textSize = isHighlighted ? "text-[11px]" : "text-[14px]"

          return (
            <div
              className={cn(
                "cursor-pointer select-none pointer-events-auto flex items-center justify-center rounded-full",
                circleSize,
                textSize,
                "font-numbers tabular-nums font-medium whitespace-nowrap",
                "text-white",
                borderClass,
                isHighlighted && "ring-2 ring-black ring-offset-1"
              )}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                transform: `translate(-50%, -50%) translate(${offset.dx}px, ${offset.dy}px)`,
                zIndex: zIndex,
                pointerEvents: "auto",
                backgroundColor: `rgb(${roadColor[0]}, ${roadColor[1]}, ${roadColor[2]})`,
                // Mobile optimization: hint to browser that this element will change
                willChange: isHighlighted ? "transform, width, height" : "auto",
              }}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                rio.events.emit("alert.hover", {
                  type: "alert",
                  alertId: alert.id,
                  alert,
                })
                rio.events.emit("object.click", {
                  type: "alert",
                  object: alert,
                })
                setTimeout(() => {
                  navigate(`/alerts/${alert.id}`)
                }, 50)
              }}
              onMouseEnter={(e) => {
                e.stopPropagation()
                rio.events.emit("alert.hover", {
                  type: "alert",
                  alertId: alert.id,
                  alert,
                })
              }}
              onMouseLeave={(e) => {
                e.stopPropagation()
                rio.events.emit("alert.hover", {
                  type: "alert",
                  alertId: null,
                  alert: null,
                })
              }}
            >
              {isHighlighted ? timeDisplay : "!"}
            </div>
          )
        }
      ),
    [mapStyle, isLightBaseMap, rio, navigate]
  )

  return (
    <Portkey id="map-html-overlay">
      {grouped.map(([bucketKey, items]) => {
        const anchor = items[0]

        // Use stable sort order (by alert ID) to prevent flickering on hover
        // Don't re-sort based on hover state - use z-index instead
        const sorted = [...items].sort((a, b) =>
          a.alert.id.localeCompare(b.alert.id)
        )

        const fanCount = sorted.length
        return (
          <div
            key={bucketKey}
            style={{
              position: "absolute",
              left: anchor.x,
              top: anchor.y,
              pointerEvents: "none",
            }}
          >
            {sorted.map((a, idx) => {
              const offset = getStackOffsetPx(fanCount, idx)
              const baseZ = 120
              const isHovered = hoveredAlert?.id === a.alert.id
              const isSelected = selectedAlert?.id === a.alert.id
              const highlighted = isHovered || isSelected
              // Put highlighted items on top with higher z-index, but keep stable position
              const zIndex = baseZ + idx + (highlighted ? 100 : 0)
              
              return (
                <CircleOverlay
                  key={a.alert.id}
                  projectedAlert={a}
                  offset={offset}
                  zIndex={zIndex}
                  isHovered={isHovered}
                  isSelected={isSelected}
                />
              )
            })}
          </div>
        )
      })}
    </Portkey>
  )
}
