import { Activity, Eye, EyeOff } from "lucide-react"
import { Suspense, lazy, useState } from "react"

import { useDevtools } from "../../devtools-context"

const ReactQueryDevtools = lazy(() =>
  import("@rio.js/client/devtools").then((mod) => ({
    default: mod.ReactQueryDevtools,
  }))
)

export function QueryInspector() {
  const { rio } = useDevtools()
  const [showDevtools, setShowDevtools] = useState(false)

  const queryClient = rio.query
  const queryCache = queryClient.getQueryCache()
  const queries = queryCache.getAll()

  const stats = [
    {
      label: "Total",
      value: queries.length,
      color: "text-zinc-300",
    },
    {
      label: "Fetching",
      value: queries.filter((q) => q.state.fetchStatus === "fetching").length,
      color: "text-cyan-400",
      glow: true,
    },
    {
      label: "Stale",
      value: queries.filter((q) => q.isStale()).length,
      color: "text-amber-400",
    },
    {
      label: "Inactive",
      value: queries.filter((q) => !q.getObserversCount()).length,
      color: "text-zinc-500",
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h3 className="text-[10px] font-semibold tracking-[0.1em] uppercase text-zinc-500">
          React Query
        </h3>
        <button
          onClick={() => setShowDevtools(!showDevtools)}
          className={`text-[11px] px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-colors ${
            showDevtools
              ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
              : "text-zinc-500 hover:text-zinc-300 hover:bg-[#161b22] border border-[#1c2433]"
          }`}
        >
          {showDevtools ? <EyeOff size={12} /> : <Eye size={12} />}
          {showDevtools ? "Hide" : "Show"} Devtools
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2">
        {stats.map(({ label, value, color, glow }) => (
          <div
            key={label}
            className="rounded-lg border border-[#1c2433] bg-[#0a0e14] px-3 py-2.5 text-center"
          >
            <div
              className={`text-lg font-semibold font-mono tabular-nums ${color}`}
            >
              {glow && value > 0 ? (
                <span className="relative">
                  {value}
                  <span className="absolute inset-0 blur-sm text-cyan-400 opacity-40">
                    {value}
                  </span>
                </span>
              ) : (
                value
              )}
            </div>
            <div className="text-[10px] text-zinc-600 tracking-wide uppercase mt-0.5">
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Query list */}
      <div>
        <h4 className="text-[10px] font-semibold tracking-[0.1em] uppercase text-zinc-500 mb-2 flex items-center gap-1.5">
          <Activity size={11} />
          Active Queries
        </h4>
        <div className="rounded-lg border border-[#1c2433] overflow-hidden">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-[#0a0e14] border-b border-[#1c2433]">
                <th className="text-left px-3 py-2 text-zinc-500 font-medium text-[10px] tracking-wider uppercase">
                  Query Key
                </th>
                <th className="text-left px-3 py-2 text-zinc-500 font-medium text-[10px] tracking-wider uppercase w-20">
                  Status
                </th>
                <th className="text-right px-3 py-2 text-zinc-500 font-medium text-[10px] tracking-wider uppercase w-20">
                  Observers
                </th>
              </tr>
            </thead>
            <tbody>
              {queries.slice(0, 50).map((query) => (
                <tr
                  key={query.queryHash}
                  className="border-b border-[#1c2433] last:border-0 hover:bg-[#161b22]/50 transition-colors"
                >
                  <td className="px-3 py-1.5 font-mono truncate max-w-[400px] text-zinc-400">
                    {JSON.stringify(query.queryKey)}
                  </td>
                  <td className="px-3 py-1.5">
                    <QueryStatusBadge status={query.state.status} />
                  </td>
                  <td className="px-3 py-1.5 text-right text-zinc-500 font-mono">
                    {query.getObserversCount()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {queries.length > 50 && (
          <div className="text-[10px] text-zinc-600 mt-1.5">
            Showing 50 of {queries.length} queries
          </div>
        )}
      </div>

      {showDevtools && (
        <Suspense fallback={null}>
          <ReactQueryDevtools />
        </Suspense>
      )}
    </div>
  )
}

function QueryStatusBadge({ status }: { status: string }) {
  const config: Record<string, string> = {
    success: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/20",
    error: "bg-red-500/15 text-red-400 ring-red-500/20",
    pending: "bg-cyan-500/15 text-cyan-400 ring-cyan-500/20",
  }

  return (
    <span
      className={`text-[9px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-full ring-1 ${
        config[status] || "bg-zinc-800 text-zinc-500 ring-zinc-700"
      }`}
    >
      {status}
    </span>
  )
}
