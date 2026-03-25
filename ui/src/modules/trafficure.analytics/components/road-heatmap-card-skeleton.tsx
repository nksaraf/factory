import { Skeleton } from "@rio.js/ui/components/skeleton"

export function RoadHeatmapCardSkeleton() {
  return (
    <div className="px-4 flex flex-col gap-2">
      <div className="rounded-lg border border-scale-500 bg-scale-100 p-4 overflow-hidden">
        <div className="flex flex-col gap-2 min-w-0">
          {/* Header with badges inline */}
          <div className="flex items-center justify-between gap-3 min-w-0">
            <Skeleton className="h-6 w-40 shrink-0" />
            <div className="flex items-center gap-2 min-w-0 shrink">
              <Skeleton className="h-9 w-[85px] sm:w-[100px] shrink" />
              <Skeleton className="h-9 w-[85px] sm:w-[100px] shrink" />
            </div>
          </div>

          {/* Busiest hour and day - Major Focus */}
          <div className="flex justify-end min-w-0 pr-4">
            <div className="p-1 flex items-center gap-3 sm:gap-4 min-w-0 shrink">
              <div className="flex items-center gap-1 shrink-0">
                <Skeleton className="h-4 w-[72px]" />
                <Skeleton className="h-4 w-[56px]" />
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Skeleton className="h-4 w-[80px]" />
                <Skeleton className="h-4 w-[48px]" />
              </div>
            </div>
          </div>

          {/* Weekly Heatmap */}
          <div className="flex flex-col gap-0 -mt-2">
            <div className="h-[160px]">
              <Skeleton className="h-full w-full" />
            </div>

            {/* Legend */}
            <div className="flex flex-col gap-2 pt-0">
              <div className="flex">
                <div className="w-[40px]" />
                <Skeleton className="flex-1 h-2 rounded-sm" />
                <div className="w-4" />
              </div>
              <div className="flex">
                <div className="w-[40px]" />
                <div className="flex-1 flex items-center justify-between">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-24" />
                </div>
                <div className="w-4" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

