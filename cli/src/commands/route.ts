import { getFactoryClient, getFactoryRestClient } from "../client.js"
import { styleInfo } from "../cli-style.js"
import type { DxBase } from "../dx-root.js"
import { exitWithError } from "../lib/cli-exit.js"
import { printTable } from "../output.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { toDxFlags } from "./dx-flags.js"
import {
  actionResult,
  apiCall,
  colorStatus,
  resolveStatus,
  styleBold,
  styleMuted,
  styleSuccess,
  styleWarn,
} from "./list-helpers.js"

setExamples("route", [
  "$ dx route list                    List all routes",
  "$ dx route create --domain api.example.com --target my-svc --port 8080",
  "$ dx route delete <id>             Remove a route",
  "$ dx route trace factory.lepton.software   Trace domain path",
])

async function getGatewayApi() {
  return getFactoryClient()
}

export function routeCommand(app: DxBase) {
  return (
    app
      .sub("route")
      .meta({ description: "Gateway route management" })

      // dx route list [--kind workbench] [--site my-site]
      .command("list", (c) =>
        c
          .meta({ description: "List routes" })
          .flags({
            kind: {
              type: "string",
              description:
                "Filter by kind (dev, tunnel, preview, ingress, custom_domain)",
            },
            site: { type: "string", description: "Filter by site ID" },
            status: {
              type: "string",
              alias: "s",
              description: "Filter by status",
            },
            sort: {
              type: "string",
              description: "Sort by: domain, kind, status (default: domain)",
            },
            limit: {
              type: "number",
              alias: "n",
              description: "Limit results (default: 50)",
            },
          })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            const api = await getGatewayApi()
            const result = await apiCall(flags, () =>
              api.api.v1.factory.infra.routes.get({
                query: {
                  kind: flags.kind as string | undefined,
                  siteId: flags.site as string | undefined,
                  status: flags.status as string | undefined,
                },
              })
            )

            const resultObj = (
              result && typeof result === "object" ? result : {}
            ) as Record<string, unknown>
            const routes = (
              Array.isArray(resultObj.data)
                ? resultObj.data
                : Array.isArray(result)
                  ? result
                  : []
            ) as Record<string, unknown>[]
            if (f.json) {
              console.log(
                JSON.stringify({ success: true, data: routes }, null, 2)
              )
              return
            }
            if (routes.length === 0) {
              console.log("No routes found.")
              return
            }
            const rows = routes.map((r) => [
              styleMuted(String(r.routeId)),
              String(r.kind ?? ""),
              styleBold(String(r.domain)),
              String(r.targetService ?? ""),
              String(r.targetPort ?? "-"),
              colorStatus(resolveStatus(r.status)),
            ])
            console.log(
              printTable(
                ["ID", "Kind", "Domain", "Target", "Port", "Status"],
                rows
              )
            )
          })
      )

      // dx route create --domain app.example.com --target my-svc --port 8080
      .command("create", (c) =>
        c
          .meta({ description: "Create a route" })
          .flags({
            domain: {
              type: "string",
              description: "Route domain",
              required: true,
            },
            target: {
              type: "string",
              description: "Target service name",
              required: true,
            },
            port: { type: "number", description: "Target port" },
            kind: {
              type: "string",
              description: "Route kind (ingress, dev, etc.)",
            },
            site: { type: "string", description: "Site ID" },
            path: { type: "string", description: "Path prefix" },
            protocol: {
              type: "string",
              description: "Protocol (http, grpc, tcp)",
            },
          })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            if (!flags.domain || !flags.target) {
              exitWithError(
                f,
                "Usage: dx route create --domain <domain> --target <service> [--port <port>]"
              )
            }

            const api = await getGatewayApi()
            const result = await apiCall(flags, () =>
              api.api.v1.factory.infra.routes.post({
                kind: (flags.kind as string) ?? "ingress",
                domain: flags.domain as string,
                targetService: flags.target as string,
                targetPort: flags.port as number | undefined,
                siteId: flags.site as string | undefined,
                pathPrefix: flags.path as string | undefined,
                protocol: flags.protocol as string | undefined,
              })
            )

            const resultObj = (
              result && typeof result === "object" ? result : {}
            ) as Record<string, unknown>
            const routeData = (
              resultObj.data && typeof resultObj.data === "object"
                ? resultObj.data
                : resultObj
            ) as Record<string, unknown>
            if (f.json) {
              console.log(
                JSON.stringify({ success: true, data: routeData }, null, 2)
              )
            } else {
              console.log(styleSuccess(`Route created: ${routeData.routeId}`))
              console.log(`  Domain: ${routeData.domain}`)
              console.log(
                `  Target: ${routeData.targetService}:${routeData.targetPort ?? 80}`
              )
            }
          })
      )

      // dx route delete <routeId>
      .command("delete", (c) =>
        c
          .meta({ description: "Delete a route" })
          .args([
            {
              name: "id",
              type: "string",
              description: "Route ID to delete",
            },
          ])
          .run(async ({ args, flags }) => {
            const f = toDxFlags(flags)
            const id = args.id
            if (!id) {
              exitWithError(f, "Usage: dx route delete <routeId>")
            }

            const api = await getGatewayApi()
            await apiCall(flags, () =>
              api.api.v1.factory.infra.routes({ slugOrId: id }).delete.post()
            )

            actionResult(
              flags,
              { deleted: true, routeId: id },
              styleSuccess(`Route ${id} deleted.`)
            )
          })
      )

      // dx route trace <url|domain>
      .command("trace", (c) =>
        c
          .meta({
            description: "Trace network path for a domain or URL",
          })
          .flags({
            verbose: {
              type: "boolean",
              alias: "v",
              description: "Show detailed info (IPs, route rules, entrypoints)",
            },
          })
          .args([
            {
              name: "target",
              type: "string",
              description:
                "URL or domain to trace (e.g. https://bugs.rio.software/api, bugs.rio.software:443)",
            },
          ])
          .run(async ({ args, flags }) => {
            const f = toDxFlags(flags)
            const target = args.target
            if (!target) {
              exitWithError(
                f,
                "Usage: dx route trace <url|domain>\n  e.g. dx route trace https://bugs.rio.software/api\n       dx route trace bugs.rio.software:443"
              )
            }

            const rest = await getFactoryRestClient()

            type TraceNode = {
              entity: {
                id: string
                slug: string
                name: string
                type: string
              }
              link?: {
                id: string
                slug: string
                name: string
                type: string
                spec: Record<string, unknown>
              }
              weight?: number
              implicit?: boolean
              children: TraceNode[]
            }

            type RequestContext = {
              protocol: string
              port: number
              domain?: string
              path?: string
              headers?: Record<string, string>
            }

            type TraceResponse = {
              data: {
                domain: string
                request: RequestContext
                routes: Array<{
                  slug: string
                  domain: string
                  spec: Record<string, unknown>
                }>
                trace?: {
                  request: RequestContext
                  root: TraceNode
                }
              }
            }

            // Parse target: URL, domain:port, or just domain
            // Use POST /trace/request for full URLs (carries path/protocol),
            // GET /trace/domain for simple domain/domain:port lookups
            let result: TraceResponse
            try {
              if (target.includes("://")) {
                // Full URL — use POST to carry path and protocol
                const postResult = await rest.request<{
                  data: { request: RequestContext; root: TraceNode }
                }>("POST", "/api/v1/factory/infra/trace/request", {
                  url: target,
                })
                // Wrap into the TraceResponse shape
                result = {
                  data: {
                    domain: postResult.data.request.domain ?? target,
                    request: postResult.data.request,
                    routes: [],
                    trace: postResult.data,
                  },
                }
              } else {
                let queryUrl: string
                if (target.includes(":")) {
                  const [domain, port] = target.split(":")
                  queryUrl = `/api/v1/factory/infra/trace/domain?domain=${encodeURIComponent(domain)}&port=${port}`
                } else {
                  queryUrl = `/api/v1/factory/infra/trace/domain?domain=${encodeURIComponent(target)}`
                }
                result = await rest.request<TraceResponse>("GET", queryUrl)
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              if (msg.includes("404")) {
                exitWithError(f, `No routes found for: ${target}`)
              }
              exitWithError(f, `Failed to trace: ${msg}`)
              return
            }

            const data = result.data

            if (f.json) {
              console.log(JSON.stringify({ success: true, data }, null, 2))
              return
            }

            const verbose = !!flags.verbose

            // Render request context
            const req = data.request
            console.log(
              `\n${styleBold("Trace:")} ${req.protocol}://${req.domain ?? "?"}:${req.port}${req.path ?? ""}\n`
            )

            if (!data.trace) {
              console.log(styleWarn("No trace path found for this request."))
              if (data.routes.length > 0) {
                console.log(
                  styleMuted(
                    `\n${data.routes.length} route(s) matched but no DNS entry found to start the trace.`
                  )
                )
              }
              return
            }

            // Render trace tree directly
            renderTrace(data.trace.root, verbose, req.port)
            console.log()
          })
      )
  )
}

// ---------------------------------------------------------------------------
// Trace rendering — emoji tree layout with two-level detail
// ---------------------------------------------------------------------------
//
// LOD 1 (default):  entity slug + type emoji, link type + key qualifier
// LOD 2 (--verbose): + entity spec details, + link match/tls/health details
// ---------------------------------------------------------------------------

type TraceNodeLike = {
  entity: Record<string, unknown>
  link?: { type: string; spec: Record<string, unknown> }
  weight?: number
  implicit?: boolean
  children: TraceNodeLike[]
}

type EntitySpec = Record<string, unknown>
type LinkSpec = Record<string, unknown>

const ROUTE_TYPES = new Set([
  "route",
  "ingress",
  "dev",
  "preview",
  "tunnel",
  "custom-domain",
])

const DNS_DOMAIN_TYPES = new Set(["primary", "alias", "custom"])

/** Collapse internal subtypes to human-friendly display names. */
function displayType(type: string): string {
  if (ROUTE_TYPES.has(type)) return "route"
  if (DNS_DOMAIN_TYPES.has(type)) return "dns-domain"
  return type
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined
}

/** Get emoji prefix for an entity type. */
function entityEmoji(type: string): string {
  switch (type) {
    case "route":
      return "✉️ "
    case "dns-domain":
    case "primary":
    case "alias":
    case "custom":
      return "🌐"
    case "ip-address":
      return "📍"
    case "bare-metal":
      return "🖥️ "
    case "vm":
      return "🖥️ "
    case "reverse-proxy":
      return "🔀"
    case "component":
    case "component-deployment":
    case "container":
      return "📦"
    case "service":
      return "⚡"
    default:
      return "○ "
  }
}

// ---------------------------------------------------------------------------
// LOD 1 — compact: one-line summaries always shown
// ---------------------------------------------------------------------------

/**
 * Compact entity summary (key qualifier shown after the type tag).
 * `parent` provides context — e.g., the IP address node before a host.
 */
function entitySummary(
  entity: Record<string, unknown>,
  parent: Record<string, unknown>
): string | undefined {
  const spec = (entity.spec ?? {}) as EntitySpec
  const type = displayType(String(entity.type ?? ""))
  switch (type) {
    case "dns-domain":
      return undefined
    case "ip-address":
      return str(spec.scope) ? `${spec.scope}` : undefined
    case "bare-metal":
    case "vm":
    case "lxc":
    case "cloud-instance": {
      const ip = str(spec.ipAddress)
      if (ip) return ip
      const ips = spec.ips as string[] | undefined
      if (ips?.length) return ips[0]
      return str(spec.hostname) ?? undefined
    }
    case "reverse-proxy": {
      const eps = spec.entrypoints as
        | Array<{ name: string; port: number; protocol: string }>
        | undefined
      if (!eps?.length) return undefined
      return eps.map((e) => `${e.name}(:${e.port})`).join(", ")
    }
    default:
      return undefined
  }
}

/**
 * Compact link label.
 * `parent` is the entity this link originates from — needed for dns provider/zone.
 */
function linkLabel(
  node: TraceNodeLike,
  parent: Record<string, unknown>,
  currentPort: number
): string {
  if (node.implicit) {
    return `port match :${currentPort}`
  }
  if (!node.link) return ""
  const spec = (node.link.spec ?? {}) as LinkSpec
  const port = spec.egressPort as number | undefined
  const protocol = str(spec.egressProtocol)

  // Base: link-type [protocol] [:port]
  const parts = [node.link.type]
  if (protocol) parts.push(protocol)
  if (port) parts.push(`:${port}`)

  // Contextual qualifier — one compact phrase per link type
  const extras: string[] = []
  if (node.link.type === "dns-resolution") {
    const parentSpec = (parent.spec ?? {}) as EntitySpec
    const provider = str(parentSpec.dnsProvider) ?? str(spec.provider)
    const zone =
      str(parentSpec.zone) ?? str((parent as Record<string, unknown>).fqdn)
    const recordType = str(spec.recordType)
    if (provider) extras.push(`(${provider})`)
    if (zone) extras.push(zone)
    if (recordType) extras.push(`${recordType} record`)
  }
  if (node.link.type === "nat") {
    const desc = str(spec.description) ?? str(spec.device)
    if (desc) extras.push(`(${desc})`)
  }
  if (node.link.type === "proxy") {
    const match = spec.match as
      | { hosts?: string[]; pathPrefixes?: string[] }
      | undefined
    if (match?.hosts?.length) {
      const hosts = match.hosts
      const hostStr =
        hosts.length <= 2
          ? hosts.join(", ")
          : `${hosts.slice(0, 2).join(", ")} +${hosts.length - 2}`
      extras.push(`Host(${hostStr})`)
    }
    if (match?.pathPrefixes?.length) {
      extras.push(`Path(${(match.pathPrefixes as string[]).join(", ")})`)
    }
  }

  const base = parts.join(" ")
  return extras.length > 0 ? `${base} ${extras.join(", ")}` : base
}

// ---------------------------------------------------------------------------
// LOD 2 — verbose: additional detail lines
// ---------------------------------------------------------------------------

/** Verbose detail lines for an entity. */
function entityVerbose(entity: Record<string, unknown>): string[] {
  const details: string[] = []
  const spec = (entity.spec ?? {}) as EntitySpec
  const type = displayType(String(entity.type ?? ""))

  switch (type) {
    case "dns-domain": {
      if (spec.registrar) details.push(`registrar: ${spec.registrar}`)
      if (spec.tlsMode) details.push(`tls: ${spec.tlsMode}`)
      const records = spec.records as
        | Array<{ type: string; name: string; value: string }>
        | undefined
      if (records?.length) {
        for (const r of records.slice(0, 4)) {
          details.push(`${r.type} ${r.name} → ${r.value}`)
        }
        if (records.length > 4)
          details.push(`+${records.length - 4} more records`)
      }
      break
    }
    case "ip-address":
      if (spec.role) details.push(`role: ${spec.role}`)
      if (spec.gateway) details.push(`gateway: ${spec.gateway}`)
      if (spec.interface) details.push(`iface: ${spec.interface}`)
      if (spec.macAddress) details.push(`mac: ${spec.macAddress}`)
      break
    case "bare-metal":
    case "vm":
    case "lxc":
    case "cloud-instance":
      if (spec.ipAddress) details.push(`ip: ${spec.ipAddress}`)
      if (spec.os || spec.arch)
        details.push([spec.os, spec.arch].filter(Boolean).join("/") as string)
      if (spec.cpu || spec.memoryMb)
        details.push(
          [
            spec.cpu ? `${spec.cpu} cpu` : null,
            spec.memoryMb ? `${spec.memoryMb}MB` : null,
          ]
            .filter(Boolean)
            .join(", ")
        )
      if (spec.lifecycle && spec.lifecycle !== "active")
        details.push(`lifecycle: ${spec.lifecycle}`)
      break
    case "reverse-proxy":
      if (spec.engine) details.push(`engine: ${spec.engine}`)
      if (spec.dashboardUrl) details.push(`dashboard: ${spec.dashboardUrl}`)
      break
    case "service":
      if (spec.endpoint) details.push(`endpoint: ${spec.endpoint}`)
      if (spec.provider) details.push(`provider: ${spec.provider}`)
      if (spec.version) details.push(`version: ${spec.version}`)
      break
  }

  return details
}

/** Verbose detail lines for a link. */
function linkVerbose(
  link: { type: string; spec: Record<string, unknown> },
  implicit: boolean
): string[] {
  const details: string[] = []
  const spec = (link.spec ?? {}) as LinkSpec

  if (implicit) return details

  // TLS
  const tls = spec.tls as
    | { termination?: string; certResolver?: string }
    | undefined
  if (tls?.termination) {
    const resolver = tls.certResolver ? ` (${tls.certResolver})` : ""
    details.push(`tls: ${tls.termination}${resolver}`)
  }

  // Load balancing
  const lb = spec.loadBalancing as
    | { strategy?: string; weight?: number; sticky?: boolean }
    | undefined
  if (lb?.strategy && lb.strategy !== "round-robin")
    details.push(`lb: ${lb.strategy}`)
  if (lb?.sticky) details.push("sticky sessions")

  // Health check
  const hc = spec.healthCheck as { path?: string } | undefined
  if (hc?.path) details.push(`health: ${hc.path}`)

  // Middlewares
  const mw = spec.middlewares as Array<{ name: string }> | undefined
  if (mw?.length)
    details.push(`middleware: ${mw.map((m) => m.name).join(", ")}`)

  // DNS extras
  if (link.type === "dns-resolution") {
    if (spec.ttl) details.push(`ttl: ${spec.ttl}`)
    if (spec.proxied) details.push("proxied (cdn)")
  }

  return details
}

// ---------------------------------------------------------------------------
// Tree renderer
// ---------------------------------------------------------------------------

/** Render trace tree recursively with emoji prefixes and indented branches. */
function renderTrace(
  root: TraceNodeLike,
  verbose: boolean,
  initialPort: number
) {
  function render(
    node: TraceNodeLike,
    parent: Record<string, unknown>,
    indent: string,
    isRoot: boolean,
    port: number
  ) {
    const e = node.entity
    const rawType = String(e.type ?? "?")
    const type = displayType(rawType)
    const emoji = entityEmoji(type)
    // For routes/dns-domains, show the domain/fqdn instead of the slugified internal name
    let label: string
    if (ROUTE_TYPES.has(rawType)) {
      label = String(e.domain ?? e.name ?? e.slug ?? "?")
    } else if (DNS_DOMAIN_TYPES.has(rawType)) {
      label = String(e.fqdn ?? e.name ?? e.slug ?? "?")
    } else {
      label = String(e.slug ?? e.id ?? "?")
    }

    // Update port if this link changes it
    const linkEgressPort = node.link?.spec?.egressPort as number | undefined
    const currentPort = linkEgressPort ?? port

    // --- Link connector (skip for root) ---
    if (!isRoot) {
      const label = linkLabel(node, parent, currentPort)
      if (label) {
        console.log(`${indent}│ ${styleInfo(label)}`)
        if (verbose && node.link) {
          for (const d of linkVerbose(node.link, !!node.implicit)) {
            console.log(`${indent}│ ${styleMuted(d)}`)
          }
        }
        console.log(`${indent}|`)
      }
    }

    // --- Entity line ---
    const summary = entitySummary(e, parent)
    const summaryStr = summary ? `  ${styleMuted(summary)}` : ""
    console.log(
      `${indent}${emoji} ${styleSuccess(label)} ${styleMuted(`[${type}]`)}${summaryStr}`
    )

    // Verbose entity details
    if (verbose) {
      for (const d of entityVerbose(e)) {
        console.log(`${indent}  ${styleMuted(d)}`)
      }
    }

    // --- Children ---
    if (node.children.length === 1) {
      render(node.children[0], e, indent, false, currentPort)
    } else if (node.children.length > 1) {
      for (const child of node.children) {
        console.log(`${indent}├──┐`)
        render(child, e, indent + "|  ", false, currentPort)
        console.log(`${indent}|`)
      }
    }
  }

  render(root, {}, "", true, initialPort)
}
