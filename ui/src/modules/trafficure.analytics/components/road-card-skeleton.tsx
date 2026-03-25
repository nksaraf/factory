import { Skeleton } from "@rio.js/ui/components/skeleton"
import { Card, CardContent } from "@rio.js/ui/card"

export function RoadCardSkeleton() {
  return (
    <Card className="rounded-lg border border-scale-700 overflow-hidden shadow-sm mb-2 bg-scale-100">
      <CardContent className="p-0 flex flex-col">
        {/* Line 1: Road name + Badge */}
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <Skeleton className="h-5 w-48 flex-1" />
          <Skeleton className="h-6 w-24 shrink-0" />
        </div>

        {/* Divider */}
        <div className="h-px bg-scale-500" />

        {/* Line 2: Metrics (speed, duration, distance) */}
        <div className="px-4 flex items-center justify-between flex-wrap gap-1 min-h-9 py-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5" />
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="self-stretch w-px bg-scale-500" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5" />
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="self-stretch w-px bg-scale-500" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function RoadInboxSkeleton() {
  return (
    <div>
      {Array.from({ length: 5 }).map((_, i) => (
        <RoadCardSkeleton key={i} />
      ))}
    </div>
  )
}
