import { useRef, useLayoutEffect, Suspense } from "react"
import { useParams } from "react-router"
import { useAppState } from "@rio.js/client"
import { env } from "@rio.js/env"
import { RoadSpeedCard } from "./road-speed-card"
import { RoadSpeedCardSkeleton } from "./road-speed-card-skeleton"
import { RoadHeatmapCard } from "./road-heatmap-card"
import { RoadHeatmapCardSkeleton } from "./road-heatmap-card-skeleton"
import { RoadTrendCard } from "./road-trend-card"
import { RoadTrendCardSkeleton } from "./road-trend-card-skeleton"
import { RoadAlertsCard } from "./road-alerts-card"
import { RoadAlertsCardSkeleton } from "./road-alerts-card-skeleton"
import { RoadChatCard } from "./road-chat-card"
import { RoadChatCardSkeleton } from "./road-chat-card-skeleton"
import { RoadDetailHeader } from "./road-detail-header"
import { RoadDetailHeaderSkeleton } from "./road-detail-header-skeleton"
import { RoadCardErrorBoundary } from "./road-card-error-boundary"


/** ---------- Main Component ---------- */

type Props = { 
  open?: boolean
  onClose?: () => void
}

export default function RoadDetailPanel({ open = true, onClose }: Props) {
  const { roadId } = useParams()

  // Check if Trafficure Assistant is enabled
  const enableTrafficureAssistant = env.PUBLIC_ENABLE_TRAFFICURE_ASSISTANT === "true"

  // Header ref for measuring height
  const headerRef = useRef<HTMLDivElement>(null)

  // Snap points state
  const [, setSnapPoint] = useAppState<{ snapPoints: (number | string)[]; activeSnapPoint: number | string }>("main-drawer.snap-points", { snapPoints: ['56px', 0.9], activeSnapPoint: '56px' })

  // Measure header height and update snap points
  // Include drawer handle height: h-1 (4px) + my-2 (16px) = 20px
  const DRAWER_HANDLE_HEIGHT = 20
  useLayoutEffect(() => {
    if (!roadId || !headerRef.current) return
    
    const measureHeader = () => {
      if (headerRef.current) {
        const headerHeight = headerRef.current.offsetHeight + DRAWER_HANDLE_HEIGHT
        setSnapPoint({ snapPoints: [`${headerHeight}px`, 0.9], activeSnapPoint: `${headerHeight}px` })
      }
    }
    
    // Measure immediately
    measureHeader()
    
    // Observe resize changes to header
    const resizeObserver = new ResizeObserver(() => {
      measureHeader()
    })
    
    resizeObserver.observe(headerRef.current)
    
    return () => {
      resizeObserver.disconnect()
    }
  }, [setSnapPoint, roadId])

  if (!roadId || !open) {
    return null
  }

  return (
    <div className="h-full flex flex-col bg-scale-100 overflow-hidden" key={roadId}>
          {/* Header */}
      <div ref={headerRef}>
        <RoadCardErrorBoundary >
          <Suspense fallback={<RoadDetailHeaderSkeleton />}>
            <RoadDetailHeader onClose={onClose} />
          </Suspense>
        </RoadCardErrorBoundary>
          </div>

          {/* Content */}
          <div className="flex-1 min-h-0 overflow-y-auto pretty-scroll flex flex-col gap-4 bg-[#EAEDF2] pb-2" data-vaul-no-drag>
            <div className="flex flex-col gap-4 pt-4">
              {/* Speed & Status Card */}
          <RoadCardErrorBoundary >
            <Suspense fallback={<RoadSpeedCardSkeleton />}>
              <RoadSpeedCard />
            </Suspense>
          </RoadCardErrorBoundary>

              {/* Busy Hours Pattern */}
          <RoadCardErrorBoundary >
            <Suspense fallback={<RoadHeatmapCardSkeleton />}>
              <RoadHeatmapCard />
            </Suspense>
          </RoadCardErrorBoundary>

          {/* Trend Analysis */}
          <RoadCardErrorBoundary >
            <Suspense fallback={<RoadTrendCardSkeleton />}>
              <RoadTrendCard />
            </Suspense>
          </RoadCardErrorBoundary>

          {/* Alert History */}
          <RoadCardErrorBoundary >
            <Suspense fallback={<RoadAlertsCardSkeleton />}>
              <RoadAlertsCard />
            </Suspense>
          </RoadCardErrorBoundary>

          {/* AI Chat Assistant */}
          {enableTrafficureAssistant && (
            <div className="hidden lg:block">
              <RoadCardErrorBoundary >
                <Suspense fallback={<RoadChatCardSkeleton />}>
                  <RoadChatCard />
                </Suspense>
              </RoadCardErrorBoundary>
            </div>
          )}
            </div>
          </div>
    </div>
  )
}
