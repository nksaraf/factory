import { useEffect } from "react"

import { useAppState } from "@rio.js/client"
import { fitBounds, envelope as turfEnvelope } from "@rio.js/geo"
import { useGIS } from "@rio.js/gis/hooks/use-gis"
import { useIsMobile } from "@rio.js/ui/hooks/use-is-mobile"
import { Alert } from "../alerts-data"
import { expandBoundsForFocus } from "../utils/expand-bounds"

// Helper to calculate snap point height in pixels
function getSnapPointHeight(activeSnapPoint: number | string): number {
  if (typeof activeSnapPoint === 'string') {
    return parseInt(activeSnapPoint, 10) || 0
  }
  // If it's a decimal (e.g., 0.7), multiply by viewport height
  return activeSnapPoint * window.innerHeight
}

export function useAlertFocus(alert: Alert | undefined) {
  const gis = useGIS()
  const isMobile = useIsMobile()

  // Get snap point state (only used on mobile)
  const [snapState] = useAppState<{
    snapPoints: (number | string)[]
    activeSnapPoint: number | string
  }>("main-drawer.snap-points", {
    snapPoints: ['56px', 1],
    activeSnapPoint: 1,
  })

  useEffect(() => {
    if (!alert) return

    // Calculate snap point height inside effect to ensure we get the latest value
    const snapPointHeight = isMobile ? getSnapPointHeight(snapState.activeSnapPoint) : 0

    try {
      const envelope = turfEnvelope(alert.geometry)
      const rawBounds: [[number, number], [number, number]] = [
        [envelope.bbox[0], envelope.bbox[1]],
        [envelope.bbox[2], envelope.bbox[3]],
      ]
      const bounds = expandBoundsForFocus(rawBounds)

      const mapStore = gis.getMapStore("main")
      const size = mapStore.getState().size
      // Use window dimensions for mobile, otherwise use map store size
      const width = isMobile ? window.innerWidth : (size.width || 1600)
      const height = isMobile ? window.innerHeight : (size.height || 560)
      
      // Ensure padding doesn't exceed available space (leave at least 100px for map)
      const maxBottomPadding = Math.max(0, height - 100)
      // Add extra bottom padding for mobile to ensure alert is visible above drawer
      // Mobile needs more space because drawer covers significant portion of screen
      const drawerBottomPadding = Math.min(snapPointHeight, maxBottomPadding)
      const extraMobilePadding = isMobile ? 80 : 0 // Additional 80px cushion for mobile
      const bottomPadding = drawerBottomPadding + extraMobilePadding

      // Mobile devices need much smaller horizontal padding to avoid math.gl assertion errors
      // Desktop: 240px left/right (480px total for sidebar)
      // Mobile: 24px left/right (48px total, mobile screens are only ~375-428px wide)
      const horizontalPadding = isMobile ? 24 : 240
      const topPadding = isMobile ? 16 : 32
      
      // Validate padding doesn't exceed available space (math.gl requires this)
      // If padding is too large, fitBounds will throw "@math.gl/web-mercator: assertion failed"
      const totalHorizontalPadding = horizontalPadding * 2
      const totalVerticalPadding = topPadding + bottomPadding
      
      // Safe padding: use minimum to ensure padding doesn't exceed 80% of viewport
      const padding = {
        top: Math.min(topPadding, height * 0.4),
        bottom: Math.min(bottomPadding, height * 0.4),
        left: Math.min(horizontalPadding, width * 0.4),
        right: Math.min(horizontalPadding, width * 0.4),
      }
      
      // Warn if padding was reduced (helps debug viewport issues)
      if (totalHorizontalPadding >= width * 0.8 || totalVerticalPadding >= height * 0.8) {
        console.warn("Padding reduced to fit viewport", {
          viewport: { width, height },
          requested: { horizontalPadding, topPadding, bottomPadding },
          applied: padding,
        })
      }

      const viewState = fitBounds({
        bounds,
        width,
        height,
        padding,
      })

      const baseZoom = viewState.zoom ?? 14
      const isLineGeometry =
        alert.geometry.type === "LineString" ||
        alert.geometry.type === "MultiLineString"
      const zoomBump = isLineGeometry ? 0.35 : 0.7
      viewState.zoom = Math.min(baseZoom + zoomBump, 18)

      gis.project.setViewStateRow("main", viewState)
    } catch (error) {
      console.error("Error focusing on alert:", error)
    }
  }, [alert, gis, isMobile, snapState.activeSnapPoint])
}
