import type { Alert } from "@smp/factory-shared/observability-types"
import type { DxBase } from "../dx-root.js"
import { getFactoryClient } from "../client.js"
import { formatAlertTable } from "../lib/log-formatter.js"
import { printKeyValue } from "../output.js"
import { toDxFlags } from "./dx-flags.js"
import {
  apiCall,
  actionResult,
  styleBold,
  styleMuted,
  styleSuccess,
  colorStatus,
} from "./list-helpers.js"
import { setExamples } from "../plugins/examples-plugin.js"

setExamples("alert", [
  "$ dx alert list                    List active alerts",
  "$ dx alert show <id>               Alert details",
  "$ dx alert ack <id>                Acknowledge alert",
  "$ dx alert rule list               List alert rules",
])

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
          const client = await getFactoryClient()
          const alertsRaw = await apiCall(flags, () =>
            client.api.v1.factory.observability.alerts.get({
              query: cleanQuery({
                site: flags.site,
                module: flags.module,
                severity: flags.severity,
                status: flags.status,
                since: flags.since,
                limit: flags.limit,
              }),
            })
          )
          const alerts = Array.isArray(alertsRaw) ? alertsRaw : []
          if (f.json) {
            console.log(JSON.stringify({ success: true, data: alerts }, null, 2))
          } else {
            console.log(formatAlertTable(alerts as Alert[]))
          }
        })
    )
    .command("show", (c) =>
      c
        .meta({ description: "Show alert details" })
        .args([{ name: "id", type: "string", required: true, description: "Alert ID" }])
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags)
          const client = await getFactoryClient()
          const alert_ = await apiCall(flags, () =>
            client.api.v1.factory.observability.alerts({ id: args.id }).get()
          )
          const alert = (alert_ && typeof alert_ === "object" && "data" in alert_ ? (alert_ as Record<string, unknown>).data : alert_) as Record<string, unknown> | undefined

          if (f.json) {
            console.log(JSON.stringify({ success: true, data: alert }, null, 2))
          } else if (alert) {
            console.log(
              printKeyValue({
                ID: styleMuted(String(alert.id ?? "")),
                Name: styleBold(String(alert.name ?? "")),
                Severity: String(alert.severity ?? ""),
                Status: colorStatus(String(alert.status ?? "")),
                Site: String(alert.site ?? ""),
                Module: String(alert.module ?? ""),
                Since: String(alert.since ?? ""),
                Description: String(alert.description ?? ""),
              })
            )
            const suggestedActions = alert?.suggestedActions as string[] | undefined
            if (suggestedActions?.length) {
              console.log("\nSuggested Actions:")
              for (const action of suggestedActions) {
                console.log(`  - ${action}`)
              }
            }
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
          const client = await getFactoryClient()
          const result = await apiCall(flags, () =>
            client.api.v1.factory.observability.alerts({ id: args.id }).ack.post({
              reason: flags.reason as string,
            })
          )
          actionResult(flags, result, styleSuccess(`Alert ${args.id} acknowledged.`))
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
          const client = await getFactoryClient()
          const result = await apiCall(flags, () =>
            client.api.v1.factory.observability.alerts({ id: args.id }).resolve.post({
              reason: flags.reason as string,
            })
          )
          actionResult(flags, result, styleSuccess(`Alert ${args.id} resolved.`))
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
          const client = await getFactoryClient()
          const data = await apiCall(flags, () =>
            client.api.v1.factory.observability.alerts.silence.post({
              module: flags.module as string | undefined,
              site: flags.site as string | undefined,
              duration: flags.duration as string,
              reason: flags.reason as string,
            })
          )
          const silenceData = (data && typeof data === "object" ? data : {}) as Record<string, unknown>
          actionResult(flags, data, styleSuccess(`Alerts silenced. Silence ID: ${silenceData?.silenceId}`))
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
          const client = await getFactoryClient()
          const historyRaw = await apiCall(flags, () =>
            client.api.v1.factory.observability.alerts.get({
              query: cleanQuery({
                site: flags.site,
                module: flags.module,
                severity: flags.severity,
                status: "resolved",
                since: flags.since,
                limit: flags.limit,
              }),
            })
          )
          const historyAlerts = Array.isArray(historyRaw) ? historyRaw : []
          if (f.json) {
            console.log(JSON.stringify({ success: true, data: historyAlerts }, null, 2))
          } else {
            console.log(formatAlertTable(historyAlerts as Alert[]))
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
          const client = await getFactoryClient()
          const rule = await apiCall(flags, () =>
            client.api.v1.factory.observability.alerts.rules.post({
              name: flags.name as string,
              module: flags.module as string | undefined,
              component: flags.component as string | undefined,
              metric: flags.metric as string,
              threshold: flags.threshold as string,
              severity: flags.severity as string,
              enabled: true,
              notify: flags.notify as string | undefined,
            })
          )
          const ruleData = (rule && typeof rule === "object" ? rule : {}) as Record<string, unknown>
          actionResult(flags, rule, styleSuccess(`Alert rule created: ${ruleData?.id}`))
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
              const client = await getFactoryClient()
              const rules = await apiCall(flags, () =>
                client.api.v1.factory.observability.alerts.rules.get()
              )
              if (f.json) {
                console.log(JSON.stringify({ success: true, data: rules }, null, 2))
              } else if (Array.isArray(rules) && rules.length > 0) {
                for (const r of rules) {
                  const rule = (r && typeof r === "object" ? r : {}) as Record<string, unknown>
                  const state = rule.enabled ? styleSuccess("enabled") : styleMuted("disabled")
                  console.log(`  ${styleMuted(String(rule.id))}  ${styleBold(String(rule.name).padEnd(24))} ${rule.metric} ${rule.threshold}  [${rule.severity}] ${state}`)
                }
              } else {
                console.log("No alert rules configured.")
              }
            })
        )
        .command("show", (sc) =>
          sc
            .meta({ description: "Show alert rule details" })
            .args([{ name: "id", type: "string", required: true, description: "Rule ID" }])
            .run(async ({ args, flags }) => {
              const f = toDxFlags(flags)
              const client = await getFactoryClient()
              const ruleRaw = await apiCall(flags, () =>
                client.api.v1.factory.observability.alerts.rules({ id: args.id }).get()
              )
              const rule = (ruleRaw && typeof ruleRaw === "object" ? ruleRaw : undefined) as Record<string, unknown> | undefined
              if (f.json) {
                console.log(JSON.stringify({ success: true, data: rule }, null, 2))
              } else if (rule) {
                console.log(
                  printKeyValue({
                    ID: styleMuted(String(rule.id ?? "")),
                    Name: styleBold(String(rule.name ?? "")),
                    Module: String(rule.module ?? ""),
                    Component: String(rule.component ?? ""),
                    Metric: String(rule.metric ?? ""),
                    Threshold: String(rule.threshold ?? ""),
                    Severity: String(rule.severity ?? ""),
                    Enabled: rule.enabled ? styleSuccess("yes") : styleMuted("no"),
                    Notify: String(rule.notify ?? ""),
                  })
                )
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
            .run(async ({ args, flags }) => {
              const client = await getFactoryClient()
              const result = await apiCall(flags, () =>
                client.api.v1.factory.observability.alerts.rules({ id: args.id }).update.post({
                  enabled: false,
                })
              )
              actionResult(flags, result, styleSuccess(`Alert rule ${args.id} disabled.`))
            })
        )
        .command("enable", (sc) =>
          sc
            .meta({ description: "Enable an alert rule" })
            .args([{ name: "id", type: "string", required: true, description: "Rule ID" }])
            .run(async ({ args, flags }) => {
              const client = await getFactoryClient()
              const result = await apiCall(flags, () =>
                client.api.v1.factory.observability.alerts.rules({ id: args.id }).update.post({
                  enabled: true,
                })
              )
              actionResult(flags, result, styleSuccess(`Alert rule ${args.id} enabled.`))
            })
        )
    )
}
