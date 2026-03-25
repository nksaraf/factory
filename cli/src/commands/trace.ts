import type { DxBase } from "../dx-root.js"
import { getFactoryClient } from "../client.js"
import {
  renderTraceWaterfall,
  formatTraceSummaryTable,
} from "../lib/log-formatter.js"
import { toDxFlags } from "./dx-flags.js"

export function traceCommand(app: DxBase) {
  return app
    .sub("trace")
    .meta({ description: "Distributed tracing" })
    .command("list", (c) =>
      c
        .meta({ description: "List recent traces" })
        .flags({
          site: { type: "string", description: "Target site" },
          module: { type: "string", description: "Filter by module" },
          tenant: { type: "string", description: "Filter by tenant" },
          "min-duration": {
            type: "string",
            description: "Minimum duration filter (e.g. 500ms, 2s)",
          },
          status: { type: "string", description: "Filter: ok or error" },
          since: { type: "string", description: "Start time" },
          until: { type: "string", description: "End time" },
          limit: { type: "number", description: "Max results" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags)
          try {
            const client = await getFactoryClient()
            const query: Record<string, string | undefined> = {
              site: flags.site as string | undefined,
              module: flags.module as string | undefined,
              tenant: flags.tenant as string | undefined,
              minDuration: flags["min-duration"] as string | undefined,
              status: flags.status as string | undefined,
              since: flags.since as string | undefined,
              until: flags.until as string | undefined,
              limit: flags.limit ? String(flags.limit) : undefined,
            }
            for (const k of Object.keys(query)) {
              if (query[k] === undefined) delete query[k]
            }

            const res = await (client as any).api.v1.observability.traces.get({ query })
            const traces = res.data ?? res

            if (f.json) {
              console.log(JSON.stringify(traces, null, 2))
            } else {
              console.log(formatTraceSummaryTable(traces))
            }
          } catch (err) {
            console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
            process.exit(1)
          }
        })
    )
    .command("show", (c) =>
      c
        .meta({ description: "Show trace waterfall" })
        .args([
          {
            name: "trace-id",
            type: "string",
            required: true,
            description: "Trace ID to show",
          },
        ])
        .flags({
          spans: {
            type: "boolean",
            description: "Show flat span list instead of waterfall",
          },
        })
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags)
          try {
            const client = await getFactoryClient()
            const traceId = args["trace-id"]
            const res = await (client as any).api.v1.observability.traces[traceId].get()
            const spans = res.data ?? res

            if (f.json) {
              console.log(JSON.stringify(spans, null, 2))
            } else if (flags.spans) {
              for (const span of spans) {
                console.log(
                  `${span.spanId}  ${span.operationName.padEnd(30)} ${(span.duration / 1000).toFixed(1)}ms  ${span.status}`
                )
              }
            } else {
              console.log(renderTraceWaterfall(spans))
            }
          } catch (err) {
            console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
            process.exit(1)
          }
        })
    )
    .command("find", (c) =>
      c
        .meta({ description: "Find traces by correlation" })
        .flags({
          "request-id": { type: "string", description: "Request ID" },
          deployment: { type: "string", description: "Deployment target" },
          error: { type: "string", description: "Error text search" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags)
          try {
            const client = await getFactoryClient()
            const query: Record<string, string | undefined> = {
              requestId: flags["request-id"] as string | undefined,
              deployment: flags.deployment as string | undefined,
              error: flags.error as string | undefined,
            }
            for (const k of Object.keys(query)) {
              if (query[k] === undefined) delete query[k]
            }

            const res = await (client as any).api.v1.observability.traces.find.get({ query })
            const traces = res.data ?? res

            if (f.json) {
              console.log(JSON.stringify(traces, null, 2))
            } else {
              console.log(formatTraceSummaryTable(traces))
            }
          } catch (err) {
            console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
            process.exit(1)
          }
        })
    )
    .command("open", (c) =>
      c
        .meta({ description: "Open trace in browser" })
        .args([
          {
            name: "trace-id",
            type: "string",
            required: true,
            description: "Trace ID to open",
          },
        ])
        .run(async ({ args }) => {
          const traceId = args["trace-id"]
          // URL depends on which backend is configured — for now print a message
          console.log(
            `Trace ${traceId}: Browser integration requires a configured observability backend (ClickStack or SigNoz).`
          )
          console.log("Use 'dx trace show' to view in the terminal.")
        })
    )
}
