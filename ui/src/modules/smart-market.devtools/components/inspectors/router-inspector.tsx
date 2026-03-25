import { ArrowRight, ChevronDown, ChevronRight, MapPin } from "lucide-react"
import { useCallback, useState, useSyncExternalStore } from "react"

import { useDevtools } from "../../devtools-context"

function RouteTree({ routes, depth = 0 }: { routes: any[]; depth?: number }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  return (
    <div className={depth > 0 ? "ml-3 pl-3 border-l border-[#1c2433]" : ""}>
      {routes.map((route: any, i: number) => {
        const key = route.id || route.path || `route-${i}`
        const hasChildren = route.children?.length > 0
        const isExpanded = expanded[key] ?? depth < 2

        return (
          <div key={key}>
            <div className="flex items-center gap-1.5 py-0.5 group">
              {hasChildren ? (
                <button
                  onClick={() =>
                    setExpanded((p) => ({ ...p, [key]: !isExpanded }))
                  }
                  className="text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  {isExpanded ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                </button>
              ) : (
                <span className="w-3 flex items-center justify-center">
                  <span className="size-1 rounded-full bg-zinc-700" />
                </span>
              )}
              <span className="font-mono text-[11px]">
                {(route.path ?? route.index) ? (
                  <span className="text-cyan-400">
                    {route.path || "(index)"}
                  </span>
                ) : (
                  <span className="text-zinc-500 italic">(layout)</span>
                )}
              </span>
              {route.id && (
                <span className="text-[10px] text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity">
                  {route.id}
                </span>
              )}
            </div>
            {hasChildren && isExpanded && (
              <RouteTree routes={route.children} depth={depth + 1} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function RouterInspector() {
  const { router } = useDevtools()
  const [navPath, setNavPath] = useState("")

  const subscribe = useCallback(
    (cb: () => void) => router.subscribe(cb),
    [router]
  )
  const getSnapshot = useCallback(() => router.state, [router])
  const state = useSyncExternalStore(subscribe, getSnapshot)
  const location = state.location

  return (
    <div className="space-y-5">
      {/* Current location */}
      <section>
        <SectionHeader icon={<MapPin size={12} />} title="Current Location" />
        <div className="rounded-lg border border-[#1c2433] bg-[#0a0e14] overflow-hidden">
          <div className="px-3 py-2.5 font-mono text-[11px] space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-zinc-500 w-16 shrink-0">path</span>
              <span className="text-cyan-300">{location.pathname}</span>
            </div>
            {location.search && (
              <div className="flex items-center gap-2">
                <span className="text-zinc-500 w-16 shrink-0">search</span>
                <span className="text-amber-300">{location.search}</span>
              </div>
            )}
            {location.hash && (
              <div className="flex items-center gap-2">
                <span className="text-zinc-500 w-16 shrink-0">hash</span>
                <span className="text-violet-400">{location.hash}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Matched routes */}
      <section>
        <SectionHeader title="Matched Routes" />
        <div className="space-y-0.5">
          {state.matches?.map((match: any, i: number) => (
            <div
              key={match.route.id || i}
              className="flex items-center gap-2 font-mono text-[11px] px-3 py-1.5 rounded-md bg-[#0a0e14] border border-[#1c2433]"
            >
              <span className="text-zinc-600 text-[10px] w-4 text-right shrink-0">
                {i}
              </span>
              <span className="text-cyan-400">
                {match.route.path || "(layout)"}
              </span>
              {Object.keys(match.params || {}).length > 0 && (
                <span className="text-amber-300/60 text-[10px]">
                  {JSON.stringify(match.params)}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Navigate */}
      <section>
        <SectionHeader title="Navigate" />
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (navPath) {
              router.navigate(navPath)
              setNavPath("")
            }
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={navPath}
            onChange={(e) => setNavPath(e.target.value)}
            placeholder="/path/to/navigate"
            className="flex-1 px-3 py-1.5 text-[11px] rounded-lg border border-[#1c2433] bg-[#0a0e14] font-mono text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/20 transition-all"
          />
          <button
            type="submit"
            className="px-3 py-1.5 text-[11px] font-medium bg-cyan-500/10 text-cyan-400 rounded-lg border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors flex items-center gap-1.5"
          >
            Go
            <ArrowRight size={12} />
          </button>
        </form>
      </section>

      {/* Route tree */}
      <section>
        <SectionHeader title="Route Tree" />
        <div className="rounded-lg border border-[#1c2433] bg-[#0a0e14] p-3 overflow-auto max-h-[300px] devtools-scrollbar">
          <RouteTree routes={router.routes || []} />
        </div>
      </section>
    </div>
  )
}

function SectionHeader({
  title,
  icon,
}: {
  title: string
  icon?: React.ReactNode
}) {
  return (
    <h3 className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.1em] uppercase text-zinc-500 mb-2">
      {icon}
      {title}
    </h3>
  )
}
