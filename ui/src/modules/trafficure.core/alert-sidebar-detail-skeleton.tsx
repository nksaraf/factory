import { Skeleton } from "@rio.js/ui/components/skeleton"

export function AlertSidebarDetailSkeleton() {
  return (
    <div className="h-full flex flex-col bg-scale-100 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-3 border-b bg-white border-scale-500 flex flex-col gap-1.5 relative rounded-t-lg">
        <div className="flex flex-row items-center justify-between gap-0">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-8 w-8 shrink-0" />
        </div>
        <div className="flex flex-col gap-1">
          <Skeleton className="h-4 w-80" />
          <div className="flex items-center gap-2 flex-wrap">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 w-24" />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto pretty-scroll flex flex-col gap-4 bg-[#EAEDF2] pb-2">
        {/* Alert Summary */}
        <div className="flex flex-col gap-4 pt-4">
          <div className="px-4">
            <div className="rounded-lg border border-scale-500 bg-scale-100 p-4">
              <div className="flex flex-col gap-3">
                <Skeleton className="h-5 w-40" />
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Key Metrics - 4 Cards */}
        <div className="px-4">
          <div className="rounded-lg border border-scale-500 bg-scale-100 overflow-hidden">
            <div className="grid grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className={`p-4 flex flex-col gap-1 ${
                    i % 2 === 0 ? "border-r" : ""
                  } ${i < 2 ? "border-b" : ""} border-scale-500`}
                >
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-8 w-32" />
                  <Skeleton className="h-3 w-28" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Speed Trend Graph */}
        <div className="flex flex-col gap-4">
          <div className="px-4">
            <div className="rounded-lg border border-scale-500 bg-scale-100 p-4">
              <div className="flex flex-col gap-4">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-[320px] w-full" />
              </div>
            </div>
          </div>
        </div>

        {/* Alert History Table */}
        <div className="flex flex-col gap-4">
          <div className="px-4">
            <div className="rounded-lg border border-scale-500 bg-scale-100 p-4">
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-8 w-24" />
                </div>
                <div className="border border-scale-500 rounded-lg overflow-hidden">
                  <div className="space-y-2 p-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Skeleton className="h-6 w-20" />
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-4 w-32 ml-auto" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
