import { Skeleton } from "@rio.js/ui/components/skeleton"

export function RoadSpeedCardSkeleton() {
  return (
    <div className="px-4 flex flex-col gap-2">
      <div className="rounded-lg border border-scale-500 bg-scale-100 p-4">
        <div className="flex flex-col gap-4">
          {/* Current Speed with Trend indicators */}
          <div className="flex justify-between items-stretch">
            <div className="flex flex-col">
              <Skeleton className="h-16 w-32" />
              <Skeleton className="h-4 w-40 mt-2" />
            </div>

            {/* Trend indicators - aligned with speed section */}
            <div className="flex flex-col items-end gap-2">
              <div className="flex flex-col items-end">
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-4 w-12 mt-1" />
              </div>
              <div className="flex flex-col items-end">
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-4 w-16 mt-1" />
              </div>
            </div>
          </div>

          {/* 4 Metric Cards */}
          <div className="rounded-lg border border-scale-500 bg-scale-100 overflow-hidden">
            <div className="grid grid-cols-2">
              {/* Usual Speed Card */}
              <div className="border-scale-500 border-r border-b py-2.5 px-3 flex flex-col gap-0.5">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-5 w-16 mt-1" />
              </div>

              {/* Free Flow Speed Card */}
              <div className="border-scale-500 border-b py-2.5 px-3 flex flex-col gap-0.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-16 mt-1" />
              </div>

              {/* Delay Percentage Card */}
              <div className="border-scale-500 border-r py-2.5 px-3 flex flex-col gap-0.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-5 w-12 mt-1" />
              </div>

              {/* Current Delay Card */}
              <div className="border-scale-500 py-2.5 px-3 flex flex-col gap-0.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-12 mt-1" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

