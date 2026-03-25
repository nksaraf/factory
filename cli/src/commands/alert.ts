import type { DxBase } from "../dx-root.js"
import { getFactoryClient } from "../client.js"
import { formatAlertTable } from "../lib/log-formatter.js"
import { printKeyValue } from "../output.js"
import { toDxFlags } from "./dx-flags.js"

function cleanQuery(q: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null) out[k] = String(v)
  }
  return out
}

export function alertCommand(app: DxBase) {
  return app
    .sub("alert")
    .meta({ description: "Alert management" })
    .command("list", (c) =>
      c
        .meta({ description: "List active alerts" })
        .flags({
          site: { type: "string", description: "Target site" },
          module: { type: "string", description: "Filter by module" },
          severity: { type: "string", description: "Filter: critical, warning, info" },
          status: { type: "string", description: "Filter: firing, acknowledged, resolved, silenced" },
          since: { type: "string", description: "Start time" },
          limit: { type: "number", description: "Max results" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags)
          try {
            const client = await getFactoryClient()
            const res = await (client as any).api.v1.observability.alerts.get({
              query: cleanQuery({
                site: flags.site,
                module: flags.module,
                severity: flags.severity,
                status: flags.status,
                since: flags.since,
                limit: flags.limit,
              }),
            })
            const alerts = res.data ?? res
            if (f.json) {
              console.log(JSON.stringify(alerts, null, 2))
            } else {
              console.log(formatAlertTable(alerts))
            }
          } catch (err) {
            console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
            process.exit(1)
          }
        })
    )
    .command("show", (c) =>
      c
        .meta({ description: "Show alert details" })
        .args([{ name: "id", type: "string", required: true, description: "Alert ID" }])
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags)
          try {
            const client = await getFactoryClient()
            const res = await (client as any).api.v1.observability.alerts[args.id].get()
            const alert = res.data ?? res

            if (f.json) {
              console.log(JSON.stringify(alert, null, 2))
            } else {
              console.log(
                printKeyValue({
                  ID: alert.id,
                  Name: alert.name,
                  Severity: alert.severity,
                  Status: alert.status,
                  Site: alert.site,
                  Module: alert.module,
                  Since: alert.since,
                  Description: alert.description,
                })
              )
              if (alert.suggestedActions?.length) {
                console.log("\nSuggested Actions:")
                for (const action of alert.suggestedActions) {
                  console.log(`  - ${action}`)
                }
              }
            }
          } catch (err) {
            console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
            process.exit(1)
          }
        })
    )
    .command("ack", (c) =>
      c
        .meta({ description: "Acknowledge an alert" })
        .args([{ name: "id", type: "string", required: true, description: "Alert ID" }])
        .flags({
          reason: { type: "string", required: true, description: "Acknowledgment reason" },
        })
        .run(async ({ args, flags }) => {
          try {
            const client = await getFactoryClient()
            await (client as any).api.v1.observability.alerts[args.id].ack.post({
              reason: flags.reason,
            })
            console.log(`Alert ${args.id} acknowledged.`)
          } catch (err) {
            console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
            process.exit(1)
          }
        })
    )
    .command("resolve", (c) =>
      c
        .meta({ description: "Manually resolve an alert" })
        .args([{ name: "id", type: "string", required: true, description: "Alert ID" }])
        .flags({
          reason: { type: "string", required: true, description: "Resolution reason" },
        })
        .run(async ({ args, flags }) => {
          try {
            const client = await getFactoryClient()
            await (client as any).api.v1.observability.alerts[args.id].resolve.post({
              reason: flags.reason,
            })
            console.log(`Alert ${args.id} resolved.`)
          } catch (err) {
            console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
            process.exit(1)
          }
        })
    )
    .command("silence", (c) =>
      c
        .meta({ description: "Silence alerts" })
        .flags({
          module: { type: "string", description: "Module to silence" },
          site: { type: "string", description: "Site to silence" },
          duration: { type: "string", required: true, description: "Silence duration (e.g. 2h, 30m)" },
          reason: { type: "string", required: true, description: "Silence reason" },
        })
        .run(async ({ flags }) => {
          try {
            const client = await getFactoryClient()
            const res = await (client as any).api.v1.observability.alerts.silence.post({
              module: flags.module,
              site: flags.site,
              duration: flags.duration,
              reason: flags.reason,
            })
            const data = res.data ?? res
            console.log(`Alerts silenced. Silence ID: ${data.silenceId}`)
          } catch (err) {
            console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
            process.exit(1)
          }
        })
    )
    .command("history", (c) =>
      c
        .meta({ description: "Past alert history" })
        .flags({
          site: { type: "string", description: "Target site" },
          module: { type: "string", description: "Filter by module" },
          severity: { type: "string", description: "Filter by severity" },
          since: { type: "string", description: "Start time" },
          limit: { type: "number", description: "Max results" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags)
          try {
            const client = await getFactoryClient()
            const res = await (client as any).api.v1.observability.alerts.get({
              query: cleanQuery({
                site: flags.site,
                module: flags.module,
                severity: flags.severity,
                status: "resolved",
                since: flags.since,
                limit: flags.limit,
              }),
            })
            const alerts = res.data ?? res
            if (f.json) {
              console.log(JSON.stringify(alerts, null, 2))
            } else {
              console.log(formatAlertTable(alerts))
            }
          } catch (err) {
            console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
            process.exit(1)
          }
        })
    )
    .command("create", (c) =>
      c
        .meta({ description: "Create a simple threshold alert" })
        .flags({
          name: { type: "string", required: true, description: "Alert rule name" },
          module: { type: "string", description: "Module" },
          component: { type: "string", description: "Component" },
          metric: { type: "string", required: true, description: "Metric name" },
          threshold: { type: "string", required: true, description: "Threshold expression (e.g. > 5%)" },
          severity: { type: "string", required: true, description: "Severity: critical, warning, info" },
          notify: { type: "string", description: "Notification channel" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags)
          try {
            const client = await getFactoryClient()
            const res = await (client as any).api.v1.observability.alerts.rules.post({
              name: flags.name,
              module: flags.module,
              component: flags.component,
              metric: flags.metric,
              threshold: flags.threshold,
              severity: flags.severity,
              enabled: true,
              notify: flags.notify,
            })
            const rule = res.data ?? res
            if (f.json) {
              console.log(JSON.stringify(rule, null, 2))
            } else {
              console.log(`Alert rule created: ${rule.id}`)
            }
          } catch (err) {
            console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
            process.exit(1)
          }
        })
    )
    .command("rule", (c) =>
      c
        .meta({ description: "Manage alert rules" })
        .command("list", (sc) =>
          sc
            .meta({ description: "List alert rules" })
            .run(async ({ flags }) => {
              const f = toDxFlags(flags)
              try {
                const client = await getFactoryClient()
                const res = await (client as any).api.v1.observability.alerts.rules.get()
                const rules = res.data ?? res
                if (f.json) {
                  console.log(JSON.stringify(rules, null, 2))
                } else if (Array.isArray(rules) && rules.length > 0) {
                  for (const r of rules) {
                    const state = r.enabled ? "enabled" : "disabled"
                    console.log(`  ${r.id}  ${r.name.padEnd(24)} ${r.metric} ${r.threshold}  [${r.severity}] ${state}`)
                  }
                } else {
                  console.log("No alert rules configured.")
                }
              } catch (err) {
                console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
                process.exit(1)
              }
            })
        )
        .command("show", (sc) =>
          sc
            .meta({ description: "Show alert rule details" })
            .args([{ name: "id", type: "string", required: true, description: "Rule ID" }])
            .run(async ({ args, flags }) => {
              const f = toDxFlags(flags)
              try {
                const client = await getFactoryClient()
                const res = await (client as any).api.v1.observability.alerts.rules[args.id].get()
                const rule = res.data ?? res
                if (f.json) {
                  console.log(JSON.stringify(rule, null, 2))
                } else {
                  console.log(
                    printKeyValue({
                      ID: rule.id,
                      Name: rule.name,
                      Module: rule.module,
                      Component: rule.component,
                      Metric: rule.metric,
                      Threshold: rule.threshold,
                      Severity: rule.severity,
                      Enabled: String(rule.enabled),
                      Notify: rule.notify,
                    })
                  )
                }
              } catch (err) {
                console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
                process.exit(1)
              }
            })
        )
        .command("disable", (sc) =>
          sc
            .meta({ description: "Disable an alert rule" })
            .args([{ name: "id", type: "string", required: true, description: "Rule ID" }])
            .flags({
              reason: { type: "string", description: "Reason for disabling" },
            })
            .run(async ({ args }) => {
              try {
                const client = await getFactoryClient()
                await (client as any).api.v1.observability.alerts.rules[args.id].patch({
                  enabled: false,
                })
                console.log(`Alert rule ${args.id} disabled.`)
              } catch (err) {
                console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
                process.exit(1)
              }
            })
        )
        .command("enable", (sc) =>
          sc
            .meta({ description: "Enable an alert rule" })
            .args([{ name: "id", type: "string", required: true, description: "Rule ID" }])
            .run(async ({ args }) => {
              try {
                const client = await getFactoryClient()
                await (client as any).api.v1.observability.alerts.rules[args.id].patch({
                  enabled: true,
                })
                console.log(`Alert rule ${args.id} enabled.`)
              } catch (err) {
                console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
                process.exit(1)
              }
            })
        )
    )
}
