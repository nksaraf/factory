import { useEffect, useMemo, useRef } from "react"

import { useCurrentOrganization } from "@rio.js/auth-ui/hooks/use-current-organization"
import { useRio } from "@rio.js/client"
import { fitBounds } from "@rio.js/geo"
import { WebGISProvider } from "@rio.js/gis/components/web-gis-provider"

import { useOrganizationBounds } from "../../trafficure.core/data/use-organization-bounds"

export function AnalyticsProjectProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const rio = useRio()
  const { data: activeOrganization } = useCurrentOrganization()
  const orgBounds = useOrganizationBounds()
  const prevOrgIdRef = useRef<string | undefined>(activeOrganization?.id)

  // Log organization changes
  useEffect(() => {
    const currentId = activeOrganization?.id
    if (prevOrgIdRef.current !== currentId) {
      console.log("[AnalyticsProjectProvider] Organization ID changed:", {
        prev: prevOrgIdRef.current,
        current: currentId,
        willRemount:
          prevOrgIdRef.current !== undefined &&
          currentId !== prevOrgIdRef.current,
      })
      prevOrgIdRef.current = currentId
    }
  }, [activeOrganization?.id])

  const viewState = useMemo(() => {
    if (!orgBounds?.bounds) {
      // Default bounds of India
      return fitBounds({
        bounds: [
          [68.18, 8.47],
          [97.4, 37.06],
        ],
        width: window.innerWidth,
        height: window.innerHeight,
      })
    }
    return fitBounds({
      bounds: orgBounds.bounds as [[number, number], [number, number]],
      width: window.innerWidth * 0.75,
      height: window.innerHeight * 0.9,
    })
  }, [orgBounds?.bounds])

  return (
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
            rendererType: "roads",
            source: {
              url: "https://api.traffic.management.tiler.rio.software/public.traffic_segments_tiles_v1.json",
              type: "mvt_url",
            },
            style: {
              pointRadius: 1000,
              canHover: true,
              canClick: true,
            },
            name: "Traffic",
            visible: true,
          },
        },
      }}
      key={activeOrganization?.id || "default"}
      id={`analytics/${activeOrganization?.id || "default"}`}
      onProjectChange={async () => true}
    >
      {children}
    </WebGISProvider>
  )
}
