import {
  Suspense,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react"
import { useNavigate, useParams } from "react-router"

import { useCurrentOrganization } from "@rio.js/auth-ui/hooks/use-current-organization"
import { useAppState, useRio } from "@rio.js/client"

import {
  type PeakType,
  type RoadsSort,
  type TimeScope,
  useRoadsQuery,
} from "../data/use-roads-query"
import { type Road } from "../roads-data"
import { EmptyState } from "./empty-state"
import { RoadCard } from "./road-card"
import { RoadInboxSkeleton } from "./road-card-skeleton"
import { RoadsInboxHeader } from "./roads-inbox-header"
import { RoadsQueryContext } from "./roads-query-context"
import { QUESTION_CARDS } from "./roads-questions-overlay"

const DRAWER_HANDLE_HEIGHT = 20

export function RoadsInbox() {
  const context = useContext(RoadsQueryContext)
  if (!context) {
    return null
  }

  const rio = useRio()
  const navigate = useNavigate()
  const { roadId: selectedRoadId } = useParams()
  const { data: activeOrganization } = useCurrentOrganization()
  const activeOrgId = activeOrganization?.id
  const roadRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const [hoveredRoadId, setHoveredRoadId] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  const {
    sort,
    count,
    selectedQuestion,
    filters,
    setSort,
    setCount,
    setSelectedQuestion,
    setFilters,
  } = context
  const [, startTransition] = useTransition()

  const selectedQuestionCard = selectedQuestion
    ? QUESTION_CARDS.find((q) => q.id === selectedQuestion)
    : null

  const effectiveFilters = (() => {
    if (
      selectedQuestion === "degrading_roads" ||
      selectedQuestion === "improving"
    ) {
      return { timeScope: filters.timeScope || "this_week" }
    }
    if (selectedQuestion === "peak_hour") {
      return { peakType: filters.peakType || "evening-peak" }
    }
    return selectedQuestion ? {} : filters
  })()

  const effectiveSort = (
    selectedQuestion ? { key: "severity", sortOrder: "desc" as const } : sort
  ) as RoadsSort

  const effectiveCount = selectedQuestion ? null : count
  const { roads: filteredRoads } = useRoadsQuery(
    effectiveFilters,
    effectiveSort,
    effectiveCount,
    selectedQuestion
  )

  useEffect(() => {
    const handleRoadHover = (event: {
      type: string
      roadId: string | null
      road: Road | null
      source?: string
    }) => {
      if (event.type === "road") {
        if (event.source === "detail-close") {
          setHoveredRoadId(null)
          return
        }
        if (event.source === undefined || event.source === "card") {
          setHoveredRoadId(event.roadId || null)
        }
      }
    }

    rio.events.on("road.hover", handleRoadHover)
    return () => {
      rio.events.off("road.hover", handleRoadHover)
    }
  }, [rio])

  useEffect(() => {
    const handleObjectClick = (event: any) => {
      if (event?.type !== "traffic_segment" || !event.object) return
      const properties = event.object.properties as Partial<Road> & {
        road_id?: string
      }
      const roadIdFromMap = properties.road_id
      if (!roadIdFromMap) return
      navigate(`/analytics/${roadIdFromMap}`, { replace: true })
    }

    rio.events.on("object.click", handleObjectClick)
    return () => {
      rio.events.off("object.click", handleObjectClick)
    }
  }, [rio, navigate])

  useEffect(() => {
    if (selectedRoadId) {
      const cardElement = roadRefs.current.get(selectedRoadId)
      if (cardElement && scrollContainerRef.current) {
        cardElement.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        })
      }
    }
  }, [selectedRoadId])

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 640px)")
    setIsMobile(mediaQuery.matches)

    const handleChange = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches)
    }

    mediaQuery.addEventListener("change", handleChange)
    return () => {
      mediaQuery.removeEventListener("change", handleChange)
    }
  }, [])

  const [, setSnapPoint] = useAppState<{
    snapPoints: (number | string)[]
    activeSnapPoint: number | string
  }>("main-drawer.snap-points", {
    snapPoints: ["56px", 0.9],
    activeSnapPoint: "56px",
  })

  useLayoutEffect(() => {
    if (headerRef.current) {
      const headerHeight = headerRef.current.offsetHeight + DRAWER_HANDLE_HEIGHT
      setSnapPoint({
        snapPoints: [`${headerHeight}px`, 0.9],
        activeSnapPoint: `${headerHeight}px`,
      })
    }
  }, [setSnapPoint, selectedQuestionCard])

  const handleFiltersChange = (newFilters: {
    searchTerm?: string
    timeScope?: TimeScope
    peakType?: PeakType
  }) => {
    setFilters(newFilters)
  }

  const handleSortChange = (newSort: RoadsSort) => {
    setSort(newSort)
  }

  const handleCountChange = (newCount: number | null) => {
    setCount(newCount)
  }

  const handleQuestionChange = (question: string | null) => {
    startTransition(() => {
      setSelectedQuestion(question)
    })
  }

  return (
    <div className="h-full flex flex-col bg-scale-300">
      <div ref={headerRef}>
        <RoadsInboxHeader
          selectedQuestion={selectedQuestion}
          filters={filters}
          sort={sort}
          count={count}
          isMobile={isMobile}
          onFiltersChange={handleFiltersChange}
          onSortChange={handleSortChange}
          onCountChange={handleCountChange}
          onQuestionChange={handleQuestionChange}
        />
      </div>
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto pretty-scroll hide-scroll px-3 pt-2"
        data-vaul-no-drag
      >
        <Suspense key={activeOrgId} fallback={<RoadInboxSkeleton />}>
          {filteredRoads.length === 0 ? (
            <EmptyState />
          ) : (
            <div>
              {filteredRoads.map((road) => {
                const isSelected = selectedRoadId === road.road_id
                const isHovered = hoveredRoadId === road.road_id

                return (
                  <RoadCard
                    key={road.road_id}
                    ref={(el) => {
                      if (el) {
                        roadRefs.current.set(road.road_id, el)
                      } else {
                        roadRefs.current.delete(road.road_id)
                      }
                    }}
                    road={road}
                    isSelected={isSelected}
                    isHovered={isHovered}
                    sortKey={sort.key}
                    question={selectedQuestionCard}
                    onClick={() => {
                      rio.events.emit("road.hover", {
                        type: "road",
                        roadId: null,
                        road: null,
                        source: "select",
                      })
                      navigate(`/analytics/${road.road_id}`, { replace: true })
                    }}
                  />
                )
              })}
            </div>
          )}
        </Suspense>
      </div>
    </div>
  )
}
