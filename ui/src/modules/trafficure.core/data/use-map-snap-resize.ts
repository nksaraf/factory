import { useEffect } from "react"

import { useAppState } from "@rio.js/client"
import { useGIS } from "@rio.js/gis/hooks/use-gis"
import { useIsMobile } from "@rio.js/ui/hooks/use-is-mobile"

/**
 * Hook to handle map resizing when mobile drawer snap points change
 * 
 * Since the drawer is an overlay, the map container doesn't naturally resize.
 * This hook monitors snap point changes and:
 * 1. Sets CSS variable for snap point height
 * 2. Recalculates map size in store
 * 3. Forces map and layers to resize
 */
export function useMapSnapResize(mapId: string = "main") {
  const gis = useGIS()
  const isMobile = useIsMobile()

  // Get snap point state
  const [snapState] = useAppState<{
    snapPoints: (number | string)[]
    activeSnapPoint: number | string
  }>("main-drawer.snap-points", {
    snapPoints: ['56px', 1],
    activeSnapPoint: 1,
  })

  useEffect(() => {
    if (!isMobile || !gis) return

    // Calculate snap height
    const snapPoint = snapState.activeSnapPoint
    let snapHeightPx = 0
    let snapHeightCss = '0px'

    if (typeof snapPoint === 'string') {
      snapHeightPx = parseInt(snapPoint, 10) || 0
      snapHeightCss = snapPoint
    } else {
      snapHeightPx = snapPoint * window.innerHeight
      snapHeightCss = `${snapPoint * 100}vh`
    }

    // Set CSS variable for snap point height
    document.documentElement.style.setProperty('--snap-point-height', snapHeightCss)

    // Calculate new map size
    const newHeight = window.innerHeight - snapHeightPx
    const newWidth = window.innerWidth

    // Get map store and refs
    const mapStore = gis.getMapStore(mapId)
    const mapRef = mapStore.getState().refs.map
    const deckRef = mapStore.getState().refs.deck

    // Update map size in store
    mapStore.setState((state) => ({
      ...state,
      size: { width: newWidth, height: newHeight },
    }))

    // Force map to resize with delay to ensure DOM updates
    const resizeTimeout = setTimeout(() => {
      // Trigger Mapbox/Google Maps resize
      if (mapRef.current?.resize) {
        mapRef.current.resize()
      }

      // Trigger Deck.gl redraw
      if (deckRef.current?.deck) {
        deckRef.current.deck.setProps({
          width: newWidth,
          height: newHeight,
        })
        // Force redraw
        deckRef.current.deck.redraw('Map resize for snap point')
      }

      // Dispatch resize event for any other listeners
      window.dispatchEvent(new Event('resize'))
    }, 150)

    return () => {
      clearTimeout(resizeTimeout)
    }
  }, [snapState.activeSnapPoint, isMobile, gis, mapId])
}

