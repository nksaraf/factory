import { useEffect, useMemo, useRef } from "react"

import { useCurrentOrganization } from "@rio.js/auth-ui/hooks/use-current-organization"
import { useAppState } from "@rio.js/client"
import { envelope, fitBounds } from "@rio.js/geo"
import { useGIS } from "@rio.js/gis/hooks/use-gis"
import { useIsMobile } from "@rio.js/ui/hooks/use-is-mobile"

import { useAlertsQuery } from "./data/alerts"
import { useOrganizationBounds } from "./data/use-organization-bounds"
import { expandBoundsForFocus } from "./utils/expand-bounds"

// Helper to calculate snap point height in pixels
function getSnapPointHeight(activeSnapPoint: number | string): number {
  if (typeof activeSnapPoint === "string") {
    return parseInt(activeSnapPoint, 10) || 0
  }
  // If it's a decimal (e.g., 0.7), multiply by viewport height
  return activeSnapPoint * window.innerHeight
}

export function useAlertsMapViewState(options?: {
  preferAlertsBounds?: boolean
}) {
  const preferAlertsBounds = options?.preferAlertsBounds ?? false
  const orgBounds = useOrganizationBounds()
  const { data: activeOrganization } = useCurrentOrganization()
  const gis = useGIS()
  const isMobile = useIsMobile()
  const { alerts } = useAlertsQuery(
    {},
    { key: "delay_seconds", sortOrder: "desc" },
    null
  )

  // Get snap point state (only used on mobile)
  const [snapState] = useAppState<{
    snapPoints: (number | string)[]
    activeSnapPoint: number | string
  }>("main-drawer.snap-points", {
    snapPoints: ["56px", 1],
    activeSnapPoint: 1,
  })

  // Calculate bounds from active alerts only when preferAlertsBounds (alerts module only)
  const alertsBounds = useMemo(() => {
    if (!preferAlertsBounds || !alerts || alerts.length === 0) return null

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
  }, [preferAlertsBounds, alerts])

  // Track last applied state to avoid unnecessary refits
  const lastAppliedStateRef = useRef<{
    orgId: string | null
    snapPointHeight: number
    hasAlerts: boolean
  }>({ orgId: null, snapPointHeight: 0, hasAlerts: false })

  // Compute initial view state from alerts bounds (priority) or organization bounds
  useEffect(() => {
    const orgId = activeOrganization?.id ?? null
    if (!orgId) return

    // Calculate snap point height inside effect to ensure we get the latest value
    const snapPointHeight = isMobile
      ? getSnapPointHeight(snapState.activeSnapPoint)
      : 0

    // Use alerts bounds only when preferAlertsBounds (alerts module); analytics uses org bounds only
    const boundsToUse =
      preferAlertsBounds && alertsBounds ? alertsBounds : orgBounds?.bounds
    if (!boundsToUse) return

    const hasAlerts = !!alertsBounds
    const orgChanged = lastAppliedStateRef.current.orgId !== orgId
    const drawerHeightChanged =
      lastAppliedStateRef.current.snapPointHeight !== snapPointHeight
    const alertsBecameAvailable =
      preferAlertsBounds && !lastAppliedStateRef.current.hasAlerts && hasAlerts

    // Check if we need to update:
    // 1. Organization changed (initial load or org switch)
    // 2. Drawer height changed (snapPointHeight changed)
    // 3. Alerts became available (initial load with alerts)
    if (!orgChanged && !drawerHeightChanged && !alertsBecameAvailable) {
      return
    }

    // Update the ref to track current state
    lastAppliedStateRef.current = { orgId, snapPointHeight, hasAlerts }

    const mapStore = gis.getMapStore("main")
    const size = mapStore.getState().size
    // Use window dimensions for mobile, otherwise use map store size
    const width = isMobile ? window.innerWidth : size.width || window.innerWidth
    const height = isMobile
      ? window.innerHeight
      : size.height || window.innerHeight

    // Ensure padding doesn't exceed available space (leave at least 100px for map)
    const maxBottomPadding = Math.max(0, height - 100)
    const bottomPadding = Math.min(snapPointHeight, maxBottomPadding)

    let viewState = fitBounds({
      bounds: boundsToUse as [[number, number], [number, number]],
      width,
      height,
      padding: {
        top: 20,
        bottom: bottomPadding,
        left: 20,
        right: 20,
      },
    })
    // Zoom out a bit for alerts so they aren't too tight in frame
    if (preferAlertsBounds && alertsBounds && viewState.zoom != null) {
      viewState = {
        ...viewState,
        zoom: Math.max(1, viewState.zoom - 0.7),
      }
    }
    gis.project.setViewStateRow("main", viewState)
  }, [
    activeOrganization?.id,
    preferAlertsBounds,
    alertsBounds,
    orgBounds?.bounds,
    gis,
    isMobile,
    snapState.activeSnapPoint,
  ])
}
