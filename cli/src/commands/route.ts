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

      // dx route trace <domain>
      .command("trace", (c) =>
        c
          .meta({ description: "Trace network path for a domain" })
          .args([
            {
              name: "domain",
              type: "string",
              description: "Domain to trace (e.g. factory.lepton.software)",
            },
          ])
          .run(async ({ args, flags }) => {
            const f = toDxFlags(flags)
            const domain = args.domain
            if (!domain) {
              exitWithError(f, "Usage: dx route trace <domain>")
            }

            const rest = await getFactoryRestClient()

            type DomainTraceResponse = {
              data: {
                domain: string
                routes: Array<{
                  id: string
                  slug: string
                  name: string
                  domain: string
                  realmId: string | null
                  spec: Record<string, unknown>
                }>
                traces: Array<{
                  route: { slug: string; domain: string }
                  trace: {
                    origin: { slug: string; name: string; type: string }
                    hops: Array<{
                      link: {
                        slug: string
                        type: string
                        spec: Record<string, unknown>
                      }
                      entity: {
                        slug: string
                        name: string
                        type: string
                      }
                    }>
                  }
                }>
              }
            }

            let result: DomainTraceResponse
            try {
              result = await rest.request<DomainTraceResponse>(
                "GET",
                `/api/factory/infra/trace/domain?domain=${encodeURIComponent(domain)}`
              )
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              if (msg.includes("404")) {
                exitWithError(f, `No routes found for domain: ${domain}`)
              }
              exitWithError(f, `Failed to trace domain: ${msg}`)
              return // unreachable, but satisfies TS
            }

            const data = result.data

            if (f.json) {
              console.log(JSON.stringify({ success: true, data }, null, 2))
              return
            }

            // Render domain trace as a visual path
            console.log(`\n${styleBold(`Domain trace: ${domain}`)}\n`)

            if (data.traces.length === 0) {
              console.log(
                styleWarn("No traceable routes found for this domain.")
              )
              return
            }

            console.log(
              styleMuted(
                `Found ${data.traces.length} route(s) matching "${domain}"\n`
              )
            )

            for (const { route: rt, trace } of data.traces) {
              console.log(`${styleBold("Route:")} ${rt.slug} (${rt.domain})`)
              console.log(
                `${styleBold("Origin:")} ${trace.origin.name} ${styleMuted(`[${trace.origin.type}]`)}`
              )

              if (trace.hops.length === 0) {
                console.log(styleMuted("  (no outbound links found)\n"))
                continue
              }

              // Render hop chain
              const lines: string[] = []
              lines.push(
                `  ${styleSuccess(trace.origin.slug)} ${styleMuted(`[${trace.origin.type}]`)}`
              )

              for (const hop of trace.hops) {
                const port = hop.link.spec?.egressPort
                const protocol = hop.link.spec?.egressProtocol ?? ""
                const portStr = port ? `:${port}` : ""
                const protoStr = protocol ? `${protocol}` : ""
                const label = [hop.link.type, protoStr, portStr]
                  .filter(Boolean)
                  .join(" ")

                lines.push(
                  `    ${styleMuted("──")} ${label} ${styleMuted("──▶")}`
                )
                lines.push(
                  `  ${styleSuccess(hop.entity.slug)} ${styleMuted(`[${hop.entity.type}]`)}`
                )
              }

              console.log(lines.join("\n"))
              console.log()
            }
          })
      )
  )
}
