import { Skeleton } from "@rio.js/ui/components/skeleton"
import { Card, CardContent } from "@rio.js/ui/card"

export function AlertCardSkeleton() {
  return (
    <Card className="rounded-lg border border-scale-700 overflow-hidden shadow-sm mb-2 bg-scale-100">
      <CardContent className="p-0 flex flex-col">
        {/* Top Section: Location and Delay */}
        <div className="px-4 py-3 flex items-start justify-between gap-4">
          <Skeleton className="h-5 w-48 flex-1" />
          <Skeleton className="h-6 w-20 shrink-0" />
        </div>

        {/* Divider */}
        <div className="h-px bg-scale-500" />

        {/* Middle Section: Speed, Slowdown, Status */}
        <div className="px-4 flex items-center justify-between flex-wrap gap-1 min-h-9 py-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5" />
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="self-stretch w-px bg-scale-500" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5" />
            <Skeleton className="h-4 w-20" />
          </div>
          <div className="self-stretch w-px bg-scale-500" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-scale-500" />

        {/* Bottom Section: Duration and Actions */}
        <div className="px-4 py-2 flex items-center justify-between gap-4">
          <Skeleton className="h-4 w-40" />
          <div className="flex items-center gap-1">
            <Skeleton className="h-8 w-8" />
            <Skeleton className="h-8 w-8" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function AlertInboxSkeleton() {
  return (
    <div>
      {Array.from({ length: 5 }).map((_, i) => (
        <AlertCardSkeleton key={i} />
      ))}
    </div>
  )
}
