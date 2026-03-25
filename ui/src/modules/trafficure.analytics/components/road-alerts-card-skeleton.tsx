import { Skeleton } from "@rio.js/ui/components/skeleton"

export function RoadAlertsCardSkeleton() {
  return (
    <div className="px-4 flex flex-col gap-2">
      <div className="rounded-lg border border-scale-500 bg-scale-100 p-4">
        <div className="flex flex-col gap-3">
          {/* Header with icon and time period selector */}
          <div className="flex items-center justify-between gap-3 min-w-0">
            <Skeleton className="h-6 w-32 shrink-0" />
            <Skeleton className="h-9 w-[90px] sm:w-[110px] shrink" />
          </div>

          {/* Hero Metric Section: Total Alerts */}
          <div className="flex justify-between items-stretch">
            <div className="flex flex-col">
              <Skeleton className="h-16 w-24" />
              <Skeleton className="h-4 w-40 mt-2" />
            </div>

            {/* Right side: Trend Indicator and Most Alerts Occur */}
            <div className="flex flex-col items-end gap-2">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-6 w-16 mt-1" />
              <Skeleton className="h-4 w-28" />
            </div>
          </div>

          {/* Metrics Grid - 4 Cards */}
          <div className="rounded-lg border border-scale-500 bg-scale-100 overflow-hidden">
            <div className="grid grid-cols-2">
              {/* Average Duration */}
              <div className="border-scale-500 border-r border-b py-2.5 px-3 flex flex-col gap-0.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-16" />
              </div>

              {/* Longest Alert */}
              <div className="border-scale-500 border-b py-2.5 px-3 flex flex-col gap-0.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-5 w-16" />
              </div>

              {/* Congestion Alerts Card */}
              <div className="border-scale-500 border-r py-2.5 px-3 flex flex-col gap-0.5">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-5 w-20" />
              </div>

              {/* Rapid Deterioration Alerts Card */}
              <div className="border-scale-500 py-2.5 px-3 flex flex-col gap-0.5">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-5 w-20" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

