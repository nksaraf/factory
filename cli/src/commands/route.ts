import { getFactoryClient, getFactoryRestClient } from "../client.js"
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
                "Filter by kind (workbench, tunnel, preview, ingress, custom_domain)",
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
              description: "Route kind (ingress, workbench, etc.)",
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

            // Render the trace tree
            renderTraceTree(data.trace.root, "", true)
            console.log()
          })
      )
  )
}

/** Extract detail lines for an entity based on its type and available data. */
function entityDetails(
  entity: Record<string, unknown>,
  link?: { type: string; spec: Record<string, unknown> }
): string[] {
  const details: string[] = []
  const spec = (entity.spec ?? {}) as Record<string, unknown>
  const linkSpec = link?.spec ?? {}

  // IP address for hosts/VMs
  if (spec.ipAddress) {
    details.push(`ip: ${spec.ipAddress}`)
  }

  // DNS record info
  if (entity.fqdn && entity.fqdn !== entity.slug) {
    details.push(`fqdn: ${entity.fqdn}`)
  }

  // NAT description
  if (link?.type === "nat" && linkSpec.description) {
    details.push(`${linkSpec.description}`)
  }

  // Route rule — show matched hosts when coming from a reverse proxy
  if (link?.type === "proxy") {
    const match = linkSpec.match as
      | { hosts?: string[]; pathPrefixes?: string[] }
      | undefined
    if (match?.hosts && match.hosts.length > 0) {
      const hosts = match.hosts as string[]
      if (hosts.length <= 3) {
        details.push(`rule: Host(${hosts.join(", ")})`)
      } else {
        details.push(
          `rule: Host(${hosts.slice(0, 2).join(", ")} +${hosts.length - 2} more)`
        )
      }
    }
    if (match?.pathPrefixes && (match.pathPrefixes as string[]).length > 0) {
      details.push(`path: ${(match.pathPrefixes as string[]).join(", ")}`)
    }
  }

  // Reverse proxy entrypoints
  if (entity.type === "reverse-proxy" && spec.entrypoints) {
    const eps = spec.entrypoints as Array<{
      name: string
      port: number
      protocol: string
    }>
    const summary = eps.map((e) => `${e.name}(:${e.port})`).join(", ")
    details.push(`entrypoints: ${summary}`)
  }

  return details
}

/** Render a TraceNode tree recursively with tree-drawing characters. */
function renderTraceTree(
  node: {
    entity: Record<string, unknown>
    link?: { type: string; spec: Record<string, unknown> }
    weight?: number
    implicit?: boolean
    children: Array<{
      entity: Record<string, unknown>
      link?: { type: string; spec: Record<string, unknown> }
      weight?: number
      implicit?: boolean
      children: unknown[]
    }>
  },
  indent: string,
  isRoot: boolean
) {
  const e = node.entity
  const slug = String(e.slug ?? e.id ?? "?")
  const type = String(e.type ?? "?")

  // Render this node's entity
  const implicitTag = node.implicit ? styleMuted(" (implicit)") : ""
  console.log(
    `${indent}${styleSuccess(slug)} ${styleMuted(`[${type}]`)}${implicitTag}`
  )

  // Render detail lines for this entity
  const details = entityDetails(e, node.link ?? undefined)
  for (const detail of details) {
    console.log(`${indent}  ${styleMuted(detail)}`)
  }

  // Render link label above each child
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]
    const isLast = i === node.children.length - 1
    const connector = node.children.length > 1 ? (isLast ? "└─" : "├─") : "──"

    if (child.link) {
      const spec = child.link.spec ?? {}
      const port = spec.egressPort as number | undefined
      const protocol = (spec.egressProtocol as string) ?? ""
      const portStr = port ? `:${port}` : ""
      const protoStr = protocol ? `${protocol}` : ""
      const weightStr =
        child.weight != null && child.weight < 100 ? ` (w:${child.weight})` : ""
      const label = [child.link.type, protoStr, portStr]
        .filter(Boolean)
        .join(" ")

      console.log(
        `${indent}  ${styleMuted(connector)} ${label}${weightStr} ${styleMuted("──▶")}`
      )
    } else if (child.implicit) {
      console.log(
        `${indent}  ${styleMuted(connector)} ${styleMuted("(port match)")} ${styleMuted("──▶")}`
      )
    }

    const childIndent =
      node.children.length > 1 && !isLast ? `${indent}  │ ` : `${indent}    `
    renderTraceTree(
      child as Parameters<typeof renderTraceTree>[0],
      childIndent,
      false
    )
  }
}
