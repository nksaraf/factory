import { useMemo, useState } from "react"

import { useEnv } from "../hooks/use-queries.js"

export function EnvPage() {
  const { data, isLoading } = useEnv()
  const [filter, setFilter] = useState("")
  const [source, setSource] = useState<string>("all")
  const [reveal, setReveal] = useState(false)

  const entries = useMemo(
    () => Object.entries(data ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    [data]
  )

  const sources = useMemo(() => {
    const s = new Set<string>()
    for (const [, entry] of entries) s.add(entry.source)
    return Array.from(s).sort()
  }, [entries])

  const rows = entries.filter(([key, entry]) => {
    if (source !== "all" && entry.source !== source) return false
    if (filter) {
      const q = filter.toLowerCase()
      if (
        !key.toLowerCase().includes(q) &&
        !entry.value.toLowerCase().includes(q)
      )
        return false
    }
    return true
  })

  if (isLoading) return <div className="text-sm text-zinc-500">Loading…</div>

  const sourceCounts: Record<string, number> = {}
  for (const [, e] of entries)
    sourceCounts[e.source] = (sourceCounts[e.source] ?? 0) + 1

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Env</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Resolved env vars for this site. Secrets are masked by default.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            className="text-xs px-2 py-1 rounded border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
          >
            {reveal ? "Hide secrets" : "Reveal secrets"}
          </button>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter…"
            className="text-xs px-2 py-1 rounded border border-zinc-800 bg-zinc-900 text-zinc-200 placeholder:text-zinc-600 focus:border-sky-700 focus:outline-none w-48"
          />
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="text-sm text-zinc-500 px-4 py-8 rounded-lg border border-zinc-800 bg-zinc-900/20 text-center">
          No resolved env vars. Start a dev session with{" "}
          <code className="text-zinc-300">dx dev</code> to populate.
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setSource("all")}
              className={`text-xs px-2 py-1 rounded border ${
                source === "all"
                  ? "border-sky-600 bg-sky-600/10 text-sky-300"
                  : "border-zinc-800 text-zinc-500 hover:text-zinc-300"
              }`}
            >
              all ({entries.length})
            </button>
            {sources.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSource(s)}
                className={`text-xs px-2 py-1 rounded border ${
                  source === s
                    ? "border-sky-600 bg-sky-600/10 text-sky-300"
                    : "border-zinc-800 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {s} ({sourceCounts[s]})
              </button>
            ))}
          </div>

          <div className="rounded-lg border border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/60 text-xs text-zinc-400 uppercase sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 w-1/3">Key</th>
                  <th className="text-left px-3 py-2">Value</th>
                  <th className="text-left px-3 py-2 w-40">Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([key, entry]) => (
                  <tr
                    key={key}
                    className="border-t border-zinc-800 font-mono align-top hover:bg-zinc-900/40"
                  >
                    <td className="px-3 py-1.5 text-zinc-300">{key}</td>
                    <td className="px-3 py-1.5 break-all">
                      {entry.masked && !reveal ? (
                        <span className="text-zinc-500">***</span>
                      ) : (
                        <span className="text-zinc-200">
                          {entry.value || (
                            <span className="text-zinc-600">""</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-zinc-500">
                      <div>{entry.source}</div>
                      {entry.sourceDetail && (
                        <div className="text-zinc-600">
                          {entry.sourceDetail}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
