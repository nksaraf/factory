import { useEffect, useRef, useState } from "react"
import { Link, useParams } from "react-router"

import { StatusBadge } from "../components/status-badge.js"
import { useLogStream, useService, useServices } from "../hooks/use-queries.js"
import { resolveCatalogLinks } from "../lib/links.js"

const SECRET_RE = /(KEY|SECRET|TOKEN|PASSWORD|PASS|DATABASE_URL)$/i

function mask(value: string) {
  if (!value) return value
  if (value.length <= 4) return "***"
  return `${value.slice(0, 2)}***${value.slice(-2)}`
}

export function ServicePage() {
  const { name } = useParams<{ name: string }>()
  const { data, isLoading } = useService(name ?? "")
  const services = useServices()
  const lines = useLogStream(name ?? "")
  const logRef = useRef<HTMLPreElement | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [revealSecrets, setRevealSecrets] = useState(false)
  const [envFilter, setEnvFilter] = useState("")

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [lines, autoScroll])

  if (!name) return null
  if (isLoading) return <div className="text-sm text-zinc-500">Loading…</div>
  if (!data) return <div className="text-sm text-zinc-500">Not found.</div>

  const summary = services.data?.find((s) => s.name === name)

  const actual = data.actual as {
    status?: string
    health?: string
    image?: string
    ports?: Array<{ host: number; container?: number }>
  } | null
  const deployment = data.deployment as {
    mode?: string
    status?: {
      port?: number
      pid?: number
      phase?: string
      conditions?: Array<{
        type: string
        status: string
        reason?: string
        message?: string
      }>
      startedAt?: string
    }
    spec?: { envOverrides?: Record<string, string> }
  } | null
  const catalog = data.catalog as {
    metadata?: {
      description?: string
      tags?: string[]
      links?: Array<{ url: string; title: string; type?: string }>
      annotations?: Record<string, string>
    }
    spec?: {
      type?: string
      owner?: string
      lifecycle?: string
      image?: string
      dev?: { command?: string; workdir?: string }
      build?: { context?: string; dockerfile?: string }
      ports?: Array<{
        name?: string
        port: number
        protocol?: string
        exposure?: string
      }>
      environment?: Record<string, string>
      providesApis?: string[]
      consumesApis?: string[]
    }
  }

  const dependents =
    services.data?.filter((s) => s.deps.includes(name)).map((s) => s.name) ?? []

  const envEntries = Object.entries(catalog.spec?.environment ?? {})
  const overrideEntries = Object.entries(deployment?.spec?.envOverrides ?? {})
  const filteredEnv = envEntries.filter(([k, v]) => {
    if (!envFilter) return true
    const q = envFilter.toLowerCase()
    return k.toLowerCase().includes(q) || v.toLowerCase().includes(q)
  })

  return (
    <div className="space-y-6">
      <div>
        <Link to="/" className="text-sm text-zinc-500 hover:text-zinc-300">
          ← Back to overview
        </Link>
        <div className="flex items-start justify-between gap-4 mt-2">
          <div className="min-w-0">
            <h1 className="text-2xl font-mono truncate">{name}</h1>
            {catalog.metadata?.description && (
              <p className="text-sm text-zinc-400 mt-1">
                {catalog.metadata.description}
              </p>
            )}
            <div className="flex items-center gap-2 mt-2 text-xs text-zinc-500 flex-wrap">
              {catalog.spec?.type && (
                <span className="px-1.5 py-0.5 rounded bg-zinc-800/60">
                  {catalog.spec.type}
                </span>
              )}
              {catalog.spec?.owner && <span>owner: {catalog.spec.owner}</span>}
              {catalog.spec?.lifecycle && (
                <span>· {catalog.spec.lifecycle}</span>
              )}
              {catalog.metadata?.tags?.map((t) => (
                <span key={t} className="text-zinc-500">
                  #{t}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm shrink-0">
            {actual?.status && <StatusBadge status={actual.status} />}
            {actual?.health && actual.health !== "none" && (
              <StatusBadge status={actual.health} />
            )}
            {deployment?.mode && (
              <span className="text-zinc-500">mode: {deployment.mode}</span>
            )}
            {deployment?.status?.pid && (
              <span className="text-zinc-500 font-mono">
                PID {deployment.status.pid}
              </span>
            )}
          </div>
        </div>
      </div>

      {summary && summary.ports.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
            Endpoints
          </h2>
          <div className="rounded-lg border border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/60 text-xs text-zinc-400 uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Port</th>
                  <th className="text-left px-3 py-2">Host</th>
                  <th className="text-left px-3 py-2">Container</th>
                  <th className="text-left px-3 py-2">Protocol</th>
                  <th className="text-left px-3 py-2">URL</th>
                  <th className="text-left px-3 py-2">Tunnel</th>
                </tr>
              </thead>
              <tbody>
                {summary.ports.map((p) => (
                  <tr
                    key={`${p.name}-${p.host}`}
                    className="border-t border-zinc-800 font-mono"
                  >
                    <td className="px-3 py-2">{p.name}</td>
                    <td className="px-3 py-2">{p.host}</td>
                    <td className="px-3 py-2 text-zinc-500">
                      {p.container ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-zinc-500">{p.protocol}</td>
                    <td className="px-3 py-2">
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sky-400 hover:text-sky-300 hover:underline"
                      >
                        {p.url}
                      </a>
                    </td>
                    <td className="px-3 py-2">
                      {p.tunnelUrl ? (
                        <a
                          href={p.tunnelUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sky-400 hover:text-sky-300 hover:underline truncate"
                        >
                          {p.tunnelUrl}
                        </a>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="grid md:grid-cols-2 gap-6">
        <div>
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
            Dependencies (depends on)
          </h2>
          {data.dependencies.length === 0 ? (
            <div className="text-sm text-zinc-500 px-3 py-2 rounded border border-zinc-800 bg-zinc-900/20">
              None
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {data.dependencies.map((dep) => (
                <Link
                  key={dep}
                  to={`/services/${encodeURIComponent(dep)}`}
                  className="px-2 py-1 text-xs font-mono rounded border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-800 hover:border-zinc-700 text-zinc-300"
                >
                  {dep}
                </Link>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
            Dependents (used by)
          </h2>
          {dependents.length === 0 ? (
            <div className="text-sm text-zinc-500 px-3 py-2 rounded border border-zinc-800 bg-zinc-900/20">
              None
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {dependents.map((dep) => (
                <Link
                  key={dep}
                  to={`/services/${encodeURIComponent(dep)}`}
                  className="px-2 py-1 text-xs font-mono rounded border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-800 hover:border-zinc-700 text-zinc-300"
                >
                  {dep}
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
          Catalog
        </h2>
        <dl className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-sm grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
          <Row label="image" value={catalog.spec?.image} />
          <Row label="dev command" value={catalog.spec?.dev?.command} mono />
          <Row label="dev workdir" value={catalog.spec?.dev?.workdir} mono />
          <Row
            label="build context"
            value={catalog.spec?.build?.context}
            mono
          />
          <Row
            label="dockerfile"
            value={catalog.spec?.build?.dockerfile}
            mono
          />
          <Row
            label="provides apis"
            value={catalog.spec?.providesApis?.join(", ")}
          />
          <Row
            label="consumes apis"
            value={catalog.spec?.consumesApis?.join(", ")}
          />
        </dl>
        {(() => {
          const links = resolveCatalogLinks(catalog)
          if (links.length === 0) return null
          return (
            <div className="mt-3 flex flex-wrap gap-2">
              {links.map((l) => (
                <a
                  key={l.url}
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  title={l.url}
                  className="text-xs px-2 py-1 rounded border border-zinc-800 bg-zinc-900/40 hover:border-sky-700 text-sky-400"
                >
                  <span className="text-zinc-500 mr-1.5 uppercase text-[10px]">
                    {l.kind}
                  </span>
                  {l.title} ↗
                </a>
              ))}
            </div>
          )
        })()}
      </section>

      {overrideEntries.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
            Env Overrides ({overrideEntries.length})
          </h2>
          <div className="rounded-lg border border-zinc-800 overflow-hidden">
            <table className="w-full text-sm font-mono">
              <tbody>
                {overrideEntries.map(([k, v]) => (
                  <tr
                    key={k}
                    className="border-b border-zinc-800 last:border-0"
                  >
                    <td className="px-4 py-1.5 text-zinc-400 w-1/3">{k}</td>
                    <td className="px-4 py-1.5 text-zinc-200 truncate">
                      {SECRET_RE.test(k) && !revealSecrets ? mask(v) : v}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {envEntries.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2 gap-3">
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
              Catalog Env ({envEntries.length})
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRevealSecrets((v) => !v)}
                className="text-xs px-2 py-1 rounded border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
              >
                {revealSecrets ? "Hide secrets" : "Reveal secrets"}
              </button>
              <input
                value={envFilter}
                onChange={(e) => setEnvFilter(e.target.value)}
                placeholder="filter…"
                className="text-xs px-2 py-1 rounded border border-zinc-800 bg-zinc-900 text-zinc-200 placeholder:text-zinc-600 focus:border-sky-700 focus:outline-none w-40"
              />
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800 overflow-hidden max-h-96 overflow-y-auto">
            <table className="w-full text-xs font-mono">
              <tbody>
                {filteredEnv.map(([k, v]) => (
                  <tr
                    key={k}
                    className="border-b border-zinc-800 last:border-0"
                  >
                    <td className="px-3 py-1 text-zinc-400 w-1/3 align-top">
                      {k}
                    </td>
                    <td className="px-3 py-1 text-zinc-200 break-all">
                      {SECRET_RE.test(k) && !revealSecrets
                        ? mask(v)
                        : v || <span className="text-zinc-600">""</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
            Live Logs
          </h2>
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-500 flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="accent-sky-500"
              />
              auto-scroll
            </label>
            <span className="text-xs text-zinc-600">{lines.length} lines</span>
          </div>
        </div>
        <pre
          ref={logRef}
          className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs font-mono h-96 overflow-auto whitespace-pre-wrap leading-relaxed"
        >
          {lines.length === 0 ? (
            <span className="text-zinc-600">
              Waiting for log output… (streaming from .dx/dev/{name}.log)
            </span>
          ) : (
            lines.join("\n")
          )}
        </pre>
      </section>
    </div>
  )
}

function Row({
  label,
  value,
  mono,
}: {
  label: string
  value?: string | null
  mono?: boolean
}) {
  if (!value) return null
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd
        className={`truncate ${mono ? "font-mono text-zinc-300" : "text-zinc-200"}`}
      >
        {value}
      </dd>
    </>
  )
}
