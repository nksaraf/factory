import { useMemo, useState } from "react"
import { Link } from "react-router"

import { useCatalog } from "../hooks/use-queries.js"

type Entry = {
  kind?: string
  metadata?: {
    description?: string
    tags?: string[]
  }
  spec?: {
    type?: string
    owner?: string
    image?: string
    ports?: Array<{ name?: string; port: number; exposure?: string }>
    dev?: { command?: string }
  }
}

export function CatalogPage() {
  const { data, isLoading } = useCatalog()
  const [filter, setFilter] = useState("")

  if (isLoading) return <div className="text-sm text-zinc-500">Loading…</div>
  if (!data) return null

  const components = (data.components ?? {}) as Record<string, Entry>
  const resources = (data.resources ?? {}) as Record<string, Entry>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Catalog</h1>
          <p className="text-sm text-zinc-500 mt-1">
            All components ({Object.keys(components).length}) and resources (
            {Object.keys(resources).length}) declared in this project.
          </p>
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter…"
          className="text-xs px-2 py-1 rounded border border-zinc-800 bg-zinc-900 text-zinc-200 placeholder:text-zinc-600 focus:border-sky-700 focus:outline-none w-48"
        />
      </div>

      <CatalogTable label="Components" entries={components} filter={filter} />
      <CatalogTable label="Resources" entries={resources} filter={filter} />
    </div>
  )
}

function CatalogTable({
  label,
  entries,
  filter,
}: {
  label: string
  entries: Record<string, Entry>
  filter: string
}) {
  const rows = useMemo(() => {
    return Object.entries(entries).filter(([name, entry]) => {
      if (!filter) return true
      const q = filter.toLowerCase()
      return (
        name.toLowerCase().includes(q) ||
        (entry.metadata?.description ?? "").toLowerCase().includes(q) ||
        (entry.spec?.type ?? "").toLowerCase().includes(q) ||
        (entry.metadata?.tags ?? []).some((t) => t.toLowerCase().includes(q))
      )
    })
  }, [entries, filter])

  if (rows.length === 0) return null

  return (
    <section>
      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide mb-3">
        {label} ({rows.length})
      </h2>
      <div className="rounded-lg border border-zinc-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/60 text-xs text-zinc-400 uppercase">
            <tr>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">Type</th>
              <th className="text-left px-3 py-2">Owner</th>
              <th className="text-left px-3 py-2">Ports</th>
              <th className="text-left px-3 py-2">Image / Dev</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, entry]) => (
              <tr
                key={name}
                className="border-t border-zinc-800 align-top hover:bg-zinc-900/40"
              >
                <td className="px-3 py-2">
                  <Link
                    to={`/services/${encodeURIComponent(name)}`}
                    className="font-mono text-zinc-100 hover:text-sky-400"
                  >
                    {name}
                  </Link>
                  {entry.metadata?.description && (
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {entry.metadata.description}
                    </div>
                  )}
                  {entry.metadata?.tags && entry.metadata.tags.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {entry.metadata.tags.map((t) => (
                        <span key={t} className="text-[10px] text-zinc-500">
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {entry.spec?.type && (
                    <span className="px-1.5 py-0.5 rounded bg-zinc-800/60 text-zinc-300">
                      {entry.spec.type}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-zinc-400">
                  {entry.spec?.owner ?? "—"}
                </td>
                <td className="px-3 py-2 text-xs text-zinc-400 font-mono">
                  {entry.spec?.ports
                    ?.map(
                      (p) =>
                        `${p.name ?? p.port}:${p.port}${p.exposure ? `/${p.exposure}` : ""}`
                    )
                    .join(" ") || "—"}
                </td>
                <td className="px-3 py-2 text-xs text-zinc-500 font-mono">
                  <div className="truncate max-w-md">
                    {entry.spec?.image ?? "—"}
                  </div>
                  {entry.spec?.dev?.command && (
                    <div className="text-zinc-600 truncate max-w-md mt-0.5">
                      $ {entry.spec.dev.command}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
