export function RoadChatCardSkeleton() {
  return (
    <div className="px-4 flex flex-col gap-2">
      <div className="rounded-lg border border-scale-500 bg-scale-100 p-4">
        <div className="flex flex-col gap-3 animate-pulse">
          {/* Header skeleton */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 bg-scale-300 rounded" />
              <div className="w-24 h-5 bg-scale-300 rounded" />
            </div>
          </div>

          {/* Messages area skeleton */}
          <div className="flex flex-col gap-3 h-[200px] justify-center items-center">
            <div className="w-12 h-12 bg-scale-300 rounded-full" />
            <div className="w-48 h-4 bg-scale-300 rounded" />
            <div className="w-64 h-3 bg-scale-300 rounded" />
          </div>

          {/* Input skeleton */}
          <div className="flex gap-2">
            <div className="flex-1 h-10 bg-scale-300 rounded-md" />
            <div className="w-20 h-10 bg-scale-300 rounded-md" />
          </div>
        </div>
      </div>
    </div>
  )
}


