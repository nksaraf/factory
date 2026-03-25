import { Skeleton } from "@rio.js/ui/components/skeleton"

export function RoadTrendCardSkeleton() {
  return (
    <div className="px-4 flex flex-col gap-2">
      <div className="rounded-lg border border-scale-500 bg-scale-100 p-4">
        <div className="flex flex-col gap-4">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 min-w-0">
            <Skeleton className="h-6 w-32 shrink-0" />
            <div className="flex items-center gap-2 min-w-0 shrink">
              <Skeleton className="h-9 w-[85px] sm:w-[100px] shrink" />
              <Skeleton className="h-9 w-[85px] sm:w-[100px] shrink" />
            </div>
          </div>

          {/* Chart */}
          <div className="h-56">
            <Skeleton className="h-full w-full" />
          </div>
        </div>
      </div>
    </div>
  )
}

