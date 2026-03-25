import { Skeleton } from "@rio.js/ui/components/skeleton"

export function RoadDetailHeaderSkeleton() {
  return (
    <div className="px-6 py-3 border-b bg-white border-scale-500 flex flex-col gap-1 relative rounded-t-lg">
      {/* Line 1: Road name + Close button */}
      <div className="flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Skeleton className="h-7 w-64" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded" />
        </div>
      </div>
      
      {/* Line 2: City • Road ID • Length + Severity badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
    </div>
  )
}

