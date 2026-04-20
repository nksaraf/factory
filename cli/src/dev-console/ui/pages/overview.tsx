import { useMemo, useState } from "react"
import { Link } from "react-router"

import { StatusBadge } from "../components/status-badge.js"
import {
  useServices,
  useSession,
  useTunnelStart,
  useTunnelStop,
} from "../hooks/use-queries.js"

type Service = NonNullable<ReturnType<typeof useServices>["data"]>[number]

function HealthDot({ health }: { health: string }) {
  const color =
    health === "healthy"
      ? "bg-emerald-500"
      : health === "unhealthy"
        ? "bg-red-500"
        : health === "starting"
          ? "bg-amber-500"
          : "bg-zinc-600"
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${color}`}
      title={health}
    />
  )
}

function ModeBadge({ mode }: { mode: string }) {
  const map: Record<string, string> = {
    native: "bg-sky-500/10 text-sky-400 border-sky-500/30",
    container: "bg-violet-500/10 text-violet-400 border-violet-500/30",
    service: "bg-zinc-700/40 text-zinc-300 border-zinc-600",
    unknown: "bg-zinc-800 text-zinc-500 border-zinc-700",
  }
  const cls = map[mode] ?? map.unknown
  return (
    <span
      className={`inline-block px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide rounded border ${cls}`}
    >
      {mode}
    </span>
  )
}

function TypeChip({ type }: { type: string | null }) {
  if (!type) return null
  return (
    <span className="inline-block px-1.5 py-0.5 text-[10px] text-zinc-400 bg-zinc-800/60 rounded">
      {type}
    </span>
  )
}

function PortLink({ port }: { port: Service["ports"][number] }) {
  const isHttp = port.protocol === "http" || port.protocol === "https"
  const label = `${port.name}:${port.host}`
  if (!isHttp) {
    return <span className="text-xs font-mono text-zinc-400">{label}</span>
  }
  return (
    <a
      href={port.url}
      target="_blank"
      rel="noreferrer"
      className="text-xs font-mono text-sky-400 hover:text-sky-300 hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {label}
    </a>
  )
}

function StatsBar({ services }: { services: Service[] }) {
  const running = services.filter((s) => s.status === "running").length
  const exited = services.filter((s) => s.status === "exited").length
  const unhealthy = services.filter((s) => s.health === "unhealthy").length
  const native = services.filter((s) => s.mode === "native").length
  const container = services.filter((s) => s.mode === "container").length

  const Cell = ({
    label,
    value,
    color = "text-zinc-100",
  }: {
    label: string
    value: number
    color?: string
  }) => (
    <div className="flex flex-col items-start px-4 py-2 border-r border-zinc-800 last:border-r-0">
      <div className={`text-xl font-semibold ${color}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </div>
    </div>
  )

  return (
    <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-hidden">
      <Cell label="Total" value={services.length} />
      <Cell label="Running" value={running} color="text-emerald-400" />
      <Cell
        label="Exited"
        value={exited}
        color={exited > 0 ? "text-zinc-300" : "text-zinc-500"}
      />
      <Cell
        label="Unhealthy"
        value={unhealthy}
        color={unhealthy > 0 ? "text-red-400" : "text-zinc-500"}
      />
      <Cell label="Native" value={native} color="text-sky-400" />
      <Cell label="Container" value={container} color="text-violet-400" />
    </div>
  )
}

function TunnelCard({
  status,
  info,
  subdomain,
}: {
  status: string
  info?: {
    url: string
    subdomain: string
    portUrls?: { port: number; url: string }[]
  }
  subdomain?: string
}) {
  const start = useTunnelStart()
  const stop = useTunnelStop()
  const isOn = status === "connected"
  const busy = start.isPending || stop.isPending || status === "connecting"
  const error = start.error?.message ?? stop.error?.message

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="text-sm font-semibold text-zinc-200">Tunnel</div>
          <StatusBadge status={status} />
          {subdomain && (
            <span className="text-xs font-mono text-zinc-500">{subdomain}</span>
          )}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => (isOn ? stop.mutate() : start.mutate(true))}
          className={`text-xs px-3 py-1.5 rounded border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            isOn
              ? "border-red-700/60 bg-red-600/10 text-red-300 hover:bg-red-600/20"
              : "border-emerald-700/60 bg-emerald-600/10 text-emerald-300 hover:bg-emerald-600/20"
          }`}
        >
          {busy ? "…" : isOn ? "Stop tunnel" : "Start tunnel"}
        </button>
      </div>
      {error && <div className="text-xs text-red-400 font-mono">{error}</div>}
      {isOn && info && (
        <div className="space-y-2">
          <div className="text-xs text-zinc-500">Public URL</div>
          <a
            href={info.url}
            target="_blank"
            rel="noreferrer"
            className="block text-sm font-mono text-sky-400 hover:text-sky-300 break-all"
          >
            {info.url}
          </a>
          {info.portUrls && info.portUrls.length > 0 && (
            <>
              <div className="text-xs text-zinc-500 mt-2">Per-port URLs</div>
              <div className="flex flex-wrap gap-1.5">
                {info.portUrls.map((p) => (
                  <a
                    key={p.port}
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs px-2 py-1 rounded border border-zinc-800 bg-zinc-950 hover:border-sky-700 text-sky-400 font-mono"
                  >
                    :{p.port} ↗
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}

export function OverviewPage() {
  const session = useSession()
  const services = useServices()
  const [filter, setFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState<
    "all" | "running" | "exited" | "unhealthy"
  >("all")

  const list = services.data ?? []
  const filtered = useMemo(() => {
    return list.filter((s) => {
      if (statusFilter === "running" && s.status !== "running") return false
      if (statusFilter === "exited" && s.status !== "exited") return false
      if (statusFilter === "unhealthy" && s.health !== "unhealthy") return false
      if (filter) {
        const q = filter.toLowerCase()
        if (
          !s.name.toLowerCase().includes(q) &&
          !(s.description ?? "").toLowerCase().includes(q) &&
          !(s.type ?? "").toLowerCase().includes(q) &&
          !s.tags.some((t) => t.toLowerCase().includes(q))
        )
          return false
      }
      return true
    })
  }, [list, filter, statusFilter])

  const endpoints = useMemo(() => {
    const out: {
      name: string
      label: string
      url: string
      tunnelUrl?: string
    }[] = []
    for (const s of list) {
      if (s.status !== "running") continue
      for (const p of s.ports) {
        if (p.protocol === "http" || p.protocol === "https") {
          out.push({
            name: s.name,
            label: p.name,
            url: p.url,
            tunnelUrl: p.tunnelUrl,
          })
        }
      }
    }
    return out
  }, [list])

  return (
    <div className="space-y-6">
      <section className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {session.data?.project ?? "…"}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Site{" "}
            <span className="font-mono text-zinc-300">
              {session.data?.site.slug ?? "…"}
            </span>
            <span className="mx-2 text-zinc-700">·</span>
            Workbench{" "}
            <span className="font-mono text-zinc-300">
              {session.data?.workbench.slug ?? "…"}
            </span>
          </p>
        </div>
      </section>

      <TunnelCard
        status={session.data?.tunnel.status ?? "disconnected"}
        info={session.data?.tunnel.info}
        subdomain={session.data?.workbench.tunnelSubdomain}
      />

      <StatsBar services={list} />

      {endpoints.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide mb-2">
            Endpoints
          </h2>
          <div className="flex flex-wrap gap-2">
            {endpoints.map((e) => (
              <a
                key={`${e.name}-${e.label}-${e.url}`}
                href={e.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-zinc-800 bg-zinc-900/40 hover:border-sky-700 hover:bg-zinc-900 transition-colors"
              >
                <span className="text-xs text-zinc-400">{e.name}</span>
                <span className="text-xs text-zinc-600">/</span>
                <span className="text-xs font-mono text-sky-400">
                  {e.label}
                </span>
                <span className="text-xs font-mono text-zinc-500">
                  {e.url.replace("http://", "")}
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-3 gap-3">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide">
            Services
          </h2>
          <div className="flex items-center gap-2">
            {(["all", "running", "exited", "unhealthy"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  statusFilter === s
                    ? "border-sky-600 bg-sky-600/10 text-sky-300"
                    : "border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"
                }`}
              >
                {s}
              </button>
            ))}
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter…"
              className="text-xs px-2 py-1 rounded border border-zinc-800 bg-zinc-900 text-zinc-200 placeholder:text-zinc-600 focus:border-sky-700 focus:outline-none w-40"
            />
          </div>
        </div>

        {services.isLoading ? (
          <div className="text-sm text-zinc-500">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-zinc-500 px-4 py-8 rounded-lg border border-zinc-800 bg-zinc-900/20 text-center">
            {list.length === 0
              ? "No services running."
              : "No services match the filter."}
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/60 text-xs text-zinc-400 uppercase">
                <tr>
                  <th className="text-left px-3 py-2 w-8"></th>
                  <th className="text-left px-3 py-2">Service</th>
                  <th className="text-left px-3 py-2">Mode</th>
                  <th className="text-left px-3 py-2">Ports</th>
                  <th className="text-left px-3 py-2">Depends on</th>
                  <th className="text-left px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr
                    key={s.name}
                    className="border-t border-zinc-800 hover:bg-zinc-900/40 transition-colors"
                  >
                    <td className="px-3 py-2 align-top">
                      <HealthDot health={s.health} />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Link
                        to={`/services/${encodeURIComponent(s.name)}`}
                        className="font-mono text-sm text-zinc-100 hover:text-sky-400"
                      >
                        {s.name}
                      </Link>
                      {s.description && (
                        <div className="text-xs text-zinc-500 mt-0.5 line-clamp-1">
                          {s.description}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 mt-1">
                        <TypeChip type={s.type} />
                        {s.tags.slice(0, 3).map((t) => (
                          <span key={t} className="text-[10px] text-zinc-500">
                            #{t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <ModeBadge mode={s.mode} />
                      {s.pid && (
                        <div className="text-[10px] text-zinc-600 mt-0.5 font-mono">
                          pid {s.pid}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {s.ports.length === 0 ? (
                        <span className="text-xs text-zinc-600">—</span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {s.ports.map((p) => (
                            <PortLink key={`${p.name}-${p.host}`} port={p} />
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {s.deps.length === 0 ? (
                        <span className="text-xs text-zinc-600">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {s.deps.map((d) => (
                            <Link
                              key={d}
                              to={`/services/${encodeURIComponent(d)}`}
                              className="text-[11px] font-mono text-zinc-400 hover:text-sky-400 border border-zinc-800 rounded px-1.5 py-0.5"
                            >
                              {d}
                            </Link>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <StatusBadge status={s.status} />
                      {s.health !== "none" && (
                        <div className="text-[10px] text-zinc-500 mt-0.5">
                          {s.health}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
