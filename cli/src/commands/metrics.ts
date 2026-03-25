import type { DxBase } from "../dx-root.js"
import { getFactoryClient } from "../client.js"
import {
  formatMetricsSummaryTable,
  formatInfraMetricsTable,
} from "../lib/log-formatter.js"
import { printTable } from "../output.js"
import { toDxFlags } from "./dx-flags.js"

function cleanQuery(q: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null) out[k] = String(v)
  }
  return out
}

export function metricsCommand(app: DxBase) {
  return app
    .sub("metrics")
    .meta({ description: "Application and infrastructure metrics" })
    .command("summary", (c) =>
      c
        .meta({ description: "Overview of module health" })
        .flags({
          site: { type: "string", required: true, description: "Target site" },
          since: { type: "string", description: "Start time" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags)
          try {
            const client = await getFactoryClient()
            const res = await client.api.v1.factory.observability.metrics.summary.get({
              query: cleanQuery({ site: flags.site, since: flags.since }),
            })
            if (res.error) throw new Error(String(res.error))
            const rows = res.data
            if (f.json) {
              console.log(JSON.stringify(rows, null, 2))
            } else {
              console.log(formatMetricsSummaryTable(rows))
            }
          } catch (err) {
            console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
            process.exit(1)
          }
        })
    )
    .command("show", (c) =>
      c
        .meta({ description: "Detailed component metrics" })
        .args([
          { name: "module", type: "string", required: true, description: "Module name" },
          { name: "component", type: "string", required: true, description: "Component name" },
        ])
        .flags({
          site: { type: "string", description: "Target site" },
          since: { type: "string", description: "Start time" },
        })
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags)
          try {
            const client = await getFactoryClient()
            const res = await client.api.v1.factory.observability.metrics({ module: args.module })({ component: args.component }).get({
              query: cleanQuery({ site: flags.site, since: flags.since }),
            })
            const data = res.data ?? res
            console.log(f.json ? JSON.stringify(data, null, 2) : JSON.stringify(data, null, 2))
          } catch (err) {
            console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
            process.exit(1)
          }
        })
    )
    .command("series", (c) =>
      c
        .meta({ description: "Time series data" })
        .args([
          { name: "module", type: "string", required: true, description: "Module name" },
          { name: "component", type: "string", required: true, description: "Component name" },
        ])
        .flags({
          metric: { type: "string", required: true, description: "Metric name" },
          site: { type: "string", description: "Target site" },
          since: { type: "string", description: "Start time" },
          until: { type: "string", description: "End time" },
          interval: { type: "string", description: "Aggregation interval (e.g. 5m, 1h)" },
        })
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags)
          try {
            const client = await getFactoryClient()
            const res = await client.api.v1.factory.observability.metrics.series.get({
              query: cleanQuery({
                module: args.module,
                component: args.component,
                metric: flags.metric,
                site: flags.site,
                since: flags.since,
                until: flags.until,
                interval: flags.interval,
              }),
            })
            if (res.error) throw new Error(String(res.error))
            const series = res.data
            if (f.json) {
              console.log(JSON.stringify(series, null, 2))
            } else if (Array.isArray(series) && series.length > 0) {
              for (const s of series) {
                console.log(`\n${s.metric} ${JSON.stringify(s.labels)}`)
                const rows = s.timestamps.map((ts: string, i: number) => [
                  ts,
                  String(s.values[i]),
                ])
                console.log(printTable(["Timestamp", "Value"], rows))
              }
            } else {
              console.log("No series data.")
            }
          } catch (err) {
            console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
            process.exit(1)
          }
        })
    )
    .command("compare", (c) =>
      c
        .meta({ description: "Cross-site metric comparison" })
        .args([
          { name: "module", type: "string", required: true, description: "Module name" },
          { name: "component", type: "string", required: true, description: "Component name" },
        ])
        .flags({
          sites: { type: "string", required: true, description: "Comma-separated site names" },
          metric: { type: "string", required: true, description: "Metric name" },
          since: { type: "string", description: "Start time" },
        })
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags)
          try {
            const client = await getFactoryClient()
            const res = await client.api.v1.factory.observability.metrics.series.get({
              query: cleanQuery({
                module: args.module,
                component: args.component,
                metric: flags.metric,
                sites: flags.sites,
                since: flags.since,
              }),
            })
            const data = res.data ?? res
            console.log(f.json ? JSON.stringify(data, null, 2) : JSON.stringify(data, null, 2))
          } catch (err) {
            console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
            process.exit(1)
          }
        })
    )
    .command("infra", (c) =>
      c
        .meta({ description: "Infrastructure / node metrics" })
        .args([
          { name: "node", type: "string", description: "Node name" },
        ])
        .flags({
          site: { type: "string", description: "Target site" },
          cluster: { type: "string", description: "Cluster name" },
          since: { type: "string", description: "Start time" },
        })
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags)
          try {
            const client = await getFactoryClient()
            const res = await client.api.v1.factory.observability.metrics.infra.get({
              query: cleanQuery({
                site: flags.site,
                since: flags.since,
              }),
            })
            if (res.error) throw new Error(String(res.error))
            const rows = res.data
            if (f.json) {
              console.log(JSON.stringify(rows, null, 2))
            } else {
              console.log(formatInfraMetricsTable(rows))
            }
          } catch (err) {
            console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
            process.exit(1)
          }
        })
    )
    .command("fleet", (c) =>
      c
        .meta({ description: "Fleet-wide overview" })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags)
          try {
            const client = await getFactoryClient()
            const res = await client.api.v1.factory.observability.metrics.summary.get({ query: {} })
            if (res.error) throw new Error(String(res.error))
            const rows = res.data
            if (f.json) {
              console.log(JSON.stringify(rows, null, 2))
            } else {
              console.log(formatMetricsSummaryTable(rows))
            }
          } catch (err) {
            console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
            process.exit(1)
          }
        })
    )
    .command("build", (c) =>
      c
        .meta({ description: "Build pipeline metrics" })
        .flags({
          since: { type: "string", description: "Start time" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags)
          try {
            const client = await getFactoryClient()
            const res = await client.api.v1.factory.observability.metrics.summary.get({
              query: cleanQuery({ since: flags.since }),
            })
            const data = res.data ?? res
            console.log(f.json ? JSON.stringify(data, null, 2) : JSON.stringify(data, null, 2))
          } catch (err) {
            console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
            process.exit(1)
          }
        })
    )
    .command("query", (c) =>
      c
        .meta({ description: "Run a raw PromQL query" })
        .args([
          { name: "promql", type: "string", required: true, description: "PromQL expression" },
        ])
        .flags({
          site: { type: "string", description: "Target site" },
          since: { type: "string", description: "Start time" },
          until: { type: "string", description: "End time" },
          interval: { type: "string", description: "Step interval" },
        })
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags)
          try {
            const client = await getFactoryClient()
            const res = await client.api.v1.factory.observability.metrics.query.post({
              promql: args.promql,
              site: flags.site as string | undefined,
              since: flags.since as string | undefined,
              until: flags.until as string | undefined,
              interval: flags.interval as string | undefined,
            })
            const data = res.data ?? res
            console.log(JSON.stringify(data, null, 2))
          } catch (err) {
            console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
            process.exit(1)
          }
        })
    )
}
