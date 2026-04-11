import { getFactoryClient } from "../client.js"
import { readConfig, resolveFactoryUrl, resolveSiteUrl } from "../config.js"
import type { DxBase } from "../dx-root.js"
import { exitWithError } from "../lib/cli-exit.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { formatExecutorTypeLabel } from "../site/execution/detect.js"
import { toDxFlags } from "./dx-flags.js"
import {
  actionResult,
  apiCall,
  colorStatus,
  detailView,
  styleBold,
  styleMuted,
  styleSuccess,
  tableOrJson,
  timeAgo,
} from "./list-helpers.js"

setExamples("site", [
  "$ dx site list                     List all sites",
  "$ dx site show us-east             Show site details",
  "$ dx site start                    Start site controller",
  "$ dx site status                   Show controller status",
  "$ dx site deploy api               Deploy a component",
  "$ dx site logs api                 View component logs",
])

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getFactoryOpsApi(): Promise<any> {
  return getFactoryClient()
}

export function siteCommand(app: DxBase) {
  return (
    app
      .sub("site")
      .meta({ description: "Site management and controller" })

      // ---- Factory ops API (control plane) ----

      .command("list", (c) =>
        c
          .meta({ description: "List sites" })
          .flags({
            product: {
              type: "string",
              alias: "p",
              description: "Filter by product",
            },
            status: {
              type: "string",
              alias: "s",
              description: "Filter by status",
            },
            sort: {
              type: "string",
              description: "Sort by: name, product, status (default: name)",
            },
            limit: {
              type: "number",
              alias: "n",
              description: "Limit results (default: 50)",
            },
          })
          .run(async ({ flags }) => {
            const api = await getFactoryOpsApi()
            const result = await apiCall(flags, () =>
              api.api.v1.factory.ops.sites.get({
                query: {
                  product: flags.product as string | undefined,
                  status: flags.status as string | undefined,
                },
              })
            )
            tableOrJson(
              flags,
              result,
              ["ID", "Name", "Product", "Cluster", "Status", "Last Check-in"],
              (r) => [
                styleMuted(String(r.siteId ?? "")),
                styleBold(String(r.name ?? "")),
                String(r.product ?? ""),
                String(r.clusterId ?? "-"),
                colorStatus(String(r.status ?? "")),
                timeAgo(r.lastCheckinAt as string),
              ],
              undefined,
              { emptyMessage: "No sites found." }
            )
          })
      )

      .command("show", (c) =>
        c
          .meta({ description: "Show site details" })
          .args([
            {
              name: "name",
              type: "string",
              required: true,
              description: "Site name",
            },
          ])
          .run(async ({ args, flags }) => {
            const api = await getFactoryOpsApi()
            const result = await apiCall(flags, () =>
              api.api.v1.factory.ops.sites({ name: args.name }).get()
            )
            detailView(flags, result, [
              ["ID", (r) => styleMuted(String(r.siteId ?? ""))],
              ["Name", (r) => styleBold(String(r.name ?? ""))],
              ["Product", (r) => String(r.product ?? "")],
              ["Cluster", (r) => String(r.clusterId ?? "")],
              ["Status", (r) => colorStatus(String(r.status ?? ""))],
              ["Release", (r) => String(r.assignedRelease ?? "")],
              ["Last Check-in", (r) => timeAgo(r.lastCheckinAt as string)],
              ["Created", (r) => timeAgo(r.createdAt as string)],
            ])
          })
      )

      .command("create", (c) =>
        c
          .meta({ description: "Create a site" })
          .args([
            {
              name: "name",
              type: "string",
              required: true,
              description: "Site name",
            },
          ])
          .flags({
            product: {
              type: "string",
              required: true,
              description: "Product identifier",
            },
            cluster: {
              type: "string",
              description: "Cluster ID",
            },
          })
          .run(async ({ args, flags }) => {
            const api = await getFactoryOpsApi()
            const result = await apiCall(flags, () =>
              api.api.v1.factory.ops.sites.post({
                name: args.name,
                product: flags.product as string,
                clusterId: flags.cluster as string | undefined,
              })
            )
            actionResult(
              flags,
              result,
              styleSuccess(`Site "${args.name}" created.`)
            )
          })
      )

      .command("delete", (c) =>
        c
          .meta({ description: "Decommission a site" })
          .args([
            {
              name: "name",
              type: "string",
              required: true,
              description: "Site name",
            },
          ])
          .run(async ({ args, flags }) => {
            const api = await getFactoryOpsApi()
            const result = await apiCall(flags, () =>
              api.api.v1.factory.ops.sites.delete({
                query: { name: args.name },
              })
            )
            actionResult(
              flags,
              result,
              styleSuccess(`Site "${args.name}" deleted.`)
            )
          })
      )

      .command("assign-release", (c) =>
        c
          .meta({ description: "Assign a release to a site" })
          .args([
            {
              name: "name",
              type: "string",
              required: true,
              description: "Site name",
            },
            {
              name: "release-version",
              type: "string",
              required: true,
              description: "Release version",
            },
          ])
          .run(async ({ args, flags }) => {
            const api = await getFactoryOpsApi()
            const result = await apiCall(flags, () =>
              api.api.v1.factory.ops
                .sites({ name: args.name })
                ["assign-release"].post({
                  releaseVersion: args["release-version"],
                })
            )
            actionResult(
              flags,
              result,
              styleSuccess(
                `Release ${args["release-version"]} assigned to site "${args.name}".`
              )
            )
          })
      )

      .command("checkin", (c) =>
        c
          .meta({ description: "Perform site check-in" })
          .args([
            {
              name: "name",
              type: "string",
              required: true,
              description: "Site name",
            },
          ])
          .run(async ({ args, flags }) => {
            const api = await getFactoryOpsApi()
            const result = await apiCall(flags, () =>
              api.api.v1.factory.ops.sites({ name: args.name }).checkin.post({
                healthSnapshot: {
                  status: "healthy",
                  timestamp: new Date().toISOString(),
                },
                lastAppliedManifestVersion: 0,
              })
            )
            actionResult(
              flags,
              result,
              styleSuccess(`Site "${args.name}" checked in.`)
            )
          })
      )

      // ---- Controller lifecycle commands ----

      .command("start", (c) =>
        c
          .meta({ description: "Start site controller" })
          .flags({
            name: {
              type: "string",
              description: "Site name (reads from .dx/site.json if not set)",
            },
            standalone: {
              type: "boolean",
              description: "Run without Factory connection",
            },
            "air-gapped": {
              type: "boolean",
              description: "Run in air-gapped mode",
            },
            port: {
              type: "number",
              description: "Controller API port (default: 4590)",
            },
            interval: {
              type: "number",
              description: "Reconcile interval in seconds (default: 30)",
            },
            dir: {
              type: "string",
              description: "Working directory (default: cwd)",
            },
          })
          .run(async ({ flags }) => {
            const { startSiteController } = await import("../site/start.js")
            await startSiteController({
              siteName: flags.name as string | undefined,
              standalone: flags.standalone as boolean | undefined,
              airGapped: flags["air-gapped"] as boolean | undefined,
              port: (flags.port as number | undefined) ?? 4590,
              reconcileIntervalMs:
                ((flags.interval as number | undefined) ?? 30) * 1000,
              workingDir: (flags.dir as string | undefined) ?? process.cwd(),
            })
          })
      )

      .command("stop", (c) =>
        c
          .meta({ description: "Stop site controller" })
          .flags({
            dir: {
              type: "string",
              description: "Working directory (default: cwd)",
            },
          })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            const { existsSync, readFileSync } = await import("node:fs")
            const { join } = await import("node:path")
            const dir = (flags.dir as string | undefined) ?? process.cwd()
            const pidFile = join(dir, ".dx", "controller.pid")

            if (!existsSync(pidFile)) {
              exitWithError(f, `No controller PID file found at ${pidFile}`)
              return
            }

            const pid = Number(readFileSync(pidFile, "utf8").trim())
            if (Number.isNaN(pid)) {
              exitWithError(f, `Invalid PID in ${pidFile}`)
              return
            }

            try {
              process.kill(pid, "SIGTERM")
              console.log(`Sent SIGTERM to site controller (PID ${pid}).`)
            } catch (err) {
              exitWithError(
                f,
                `Failed to stop controller (PID ${pid}): ${err instanceof Error ? err.message : err}`
              )
            }
          })
      )

      // ---- Site-agent commands (backed by controller HTTP API) ----

      .command("status", (c) =>
        c
          .meta({ description: "Show site controller status" })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            const url = await getSiteApiUrl()
            const res = await fetch(`${url}/api/v1/site/status`)
            if (!res.ok) exitWithError(f, `Site API error: ${res.status}`)
            const data = await res.json()
            detailView(flags, data.data, [
              ["Site", (r) => styleBold(String(r.siteName ?? ""))],
              ["Mode", (r) => String(r.mode ?? "")],
              [
                "Executor",
                (r) => formatExecutorTypeLabel(String(r.executorType ?? "")),
              ],
              ["Manifest Version", (r) => String(r.manifestVersion ?? "0")],
              ["Uptime", (r) => String(r.uptime ?? "")],
              ["Last Reconcile", (r) => timeAgo(r.lastReconcileAt as string)],
            ])
          })
      )

      .command("reconcile", (c) =>
        c
          .meta({ description: "Force re-reconcile current manifest" })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            const url = await getSiteApiUrl()
            const res = await fetch(`${url}/api/v1/site/reconcile`, {
              method: "POST",
            })
            if (!res.ok) exitWithError(f, `Site API error: ${res.status}`)
            const data = await res.json()
            actionResult(
              flags,
              data.data ?? data.error,
              styleSuccess("Reconciliation triggered.")
            )
          })
      )

      .command("catalog", (c) =>
        c
          .meta({ description: "Show parsed catalog" })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            const url = await getSiteApiUrl()
            const res = await fetch(`${url}/api/v1/site/catalog`)
            if (!res.ok) exitWithError(f, `Site API error: ${res.status}`)
            const data = await res.json()
            if (toDxFlags(flags).json) {
              console.log(JSON.stringify(data.data, null, 2))
            } else {
              const catalog = data.data
              if (catalog?.components) {
                console.log(styleBold("\nComponents:"))
                for (const [name, comp] of Object.entries(catalog.components)) {
                  const c = comp as any
                  console.log(
                    `  ${styleBold(name)} (${c.spec?.type ?? "service"}) — ${c.spec?.image ?? "no image"}`
                  )
                }
              }
              if (catalog?.resources) {
                console.log(styleBold("\nResources:"))
                for (const [name, res] of Object.entries(catalog.resources)) {
                  const r = res as any
                  console.log(
                    `  ${styleBold(name)} (${r.spec?.type ?? "unknown"}) — ${r.spec?.image ?? "no image"}`
                  )
                }
              }
            }
          })
      )

      .command("deploy", (c) =>
        c
          .meta({ description: "Deploy component(s)" })
          .args([
            {
              name: "component",
              type: "string",
              description: "Component name (or --all)",
            },
          ])
          .flags({
            all: { type: "boolean", description: "Deploy all components" },
          })
          .run(async ({ args, flags }) => {
            const f = toDxFlags(flags)
            const url = await getSiteApiUrl()

            if (flags.all) {
              const res = await fetch(`${url}/api/v1/site/reconcile`, {
                method: "POST",
              })
              if (!res.ok) exitWithError(f, `Site API error: ${res.status}`)
              const data = await res.json()
              actionResult(
                flags,
                data.data,
                styleSuccess("All components reconciled.")
              )
            } else if (args.component) {
              const res = await fetch(
                `${url}/api/v1/site/components/${args.component}/deploy`,
                {
                  method: "POST",
                }
              )
              if (!res.ok) exitWithError(f, `Site API error: ${res.status}`)
              const data = await res.json()
              actionResult(
                flags,
                data.data,
                styleSuccess(`Component "${args.component}" deployed.`)
              )
            } else {
              exitWithError(f, "Provide a component name or --all")
            }
          })
      )

      .command("logs", (c) =>
        c
          .meta({ description: "View component logs" })
          .args([
            {
              name: "component",
              type: "string",
              required: true,
              description: "Component name",
            },
          ])
          .flags({
            tail: {
              type: "number",
              alias: "n",
              description: "Number of lines (default: 100)",
            },
            since: {
              type: "string",
              description: "Show logs since (e.g. '5m', '1h')",
            },
          })
          .run(async ({ args, flags }) => {
            const f = toDxFlags(flags)
            const url = await getSiteApiUrl()
            const params = new URLSearchParams()
            if (flags.tail) params.set("tail", String(flags.tail))
            if (flags.since) params.set("since", String(flags.since))
            const qs = params.toString() ? `?${params}` : ""
            const res = await fetch(
              `${url}/api/v1/site/components/${args.component}/logs${qs}`
            )
            if (!res.ok) exitWithError(f, `Site API error: ${res.status}`)
            const data = await res.json()
            console.log(data.data)
          })
      )

      .command("init", (c) =>
        c
          .meta({ description: "Run init container" })
          .args([
            {
              name: "name",
              type: "string",
              required: true,
              description: "Init container name",
            },
          ])
          .run(async ({ args, flags }) => {
            const f = toDxFlags(flags)
            const url = await getSiteApiUrl()
            const res = await fetch(
              `${url}/api/v1/site/init/${args.name}/run`,
              {
                method: "POST",
              }
            )
            if (!res.ok) exitWithError(f, `Site API error: ${res.status}`)
            const data = await res.json()
            console.log(data.data?.output ?? "")
            if (data.data?.exitCode !== 0) {
              exitWithError(
                f,
                `Init container exited with code ${data.data?.exitCode}`
              )
            }
            actionResult(
              flags,
              data.data,
              styleSuccess(`Init container "${args.name}" completed.`)
            )
          })
      )

      .command("health", (c) =>
        c
          .meta({ description: "Show component health" })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            const url = await getSiteApiUrl()
            const res = await fetch(`${url}/api/v1/site/health`)
            if (!res.ok) exitWithError(f, `Site API error: ${res.status}`)
            const data = await res.json()
            if (toDxFlags(flags).json) {
              console.log(JSON.stringify(data.data, null, 2))
            } else {
              for (const [name, health] of Object.entries(data.data ?? {})) {
                const status =
                  health === "healthy"
                    ? styleSuccess("healthy")
                    : colorStatus(String(health))
                console.log(`  ${styleBold(name)}: ${status}`)
              }
            }
          })
      )

      // ---- Manifest management ----

      .command("apply-manifest", (c) =>
        c
          .meta({
            description: "Push manifest to site controller (air-gapped)",
          })
          .args([
            {
              name: "file",
              type: "string",
              required: true,
              description: "Path to manifest JSON file",
            },
          ])
          .run(async ({ args, flags }) => {
            const f = toDxFlags(flags)
            const fs = await import("node:fs")
            const content = fs.readFileSync(args.file, "utf-8")
            const manifest = JSON.parse(content)
            const url = await getSiteApiUrl()
            const res = await fetch(`${url}/api/v1/site/manifest`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(manifest),
            })
            if (!res.ok) exitWithError(f, `Site API error: ${res.status}`)
            const data = await res.json()
            actionResult(
              flags,
              data.data,
              styleSuccess(`Manifest applied from ${args.file}.`)
            )
          })
      )

      .command("export-manifest", (c) =>
        c
          .meta({ description: "Export current manifest" })
          .flags({
            output: {
              type: "string",
              alias: "o",
              description: "Output file (default: stdout)",
            },
          })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            const url = await getSiteApiUrl()
            const res = await fetch(`${url}/api/v1/site/manifest`)
            if (!res.ok) exitWithError(f, `Site API error: ${res.status}`)
            const data = await res.json()
            const json = JSON.stringify(data.data, null, 2)
            if (flags.output) {
              const fs = await import("node:fs")
              fs.writeFileSync(flags.output as string, json)
              console.log(styleSuccess(`Manifest exported to ${flags.output}`))
            } else {
              console.log(json)
            }
          })
      )

      // ---- Legacy site-agent commands (kept for backward compat) ----

      .command("push-manifest", (c) =>
        c
          .meta({
            description:
              "Push a manifest to the site agent (use apply-manifest instead)",
          })
          .args([
            {
              name: "file",
              type: "string",
              required: true,
              description: "Path to manifest JSON file",
            },
          ])
          .run(async ({ args, flags }) => {
            const f = toDxFlags(flags)
            const fs = await import("node:fs")
            const content = fs.readFileSync(args.file, "utf-8")
            const manifest = JSON.parse(content)
            const url = await getSiteApiUrl()
            const res = await fetch(`${url}/api/v1/site/manifest`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(manifest),
            })
            if (!res.ok) exitWithError(f, `Site API error: ${res.status}`)
            const data = await res.json()
            actionResult(
              flags,
              data.data,
              styleSuccess(`Manifest pushed from ${args.file}.`)
            )
          })
      )

      .command("crds", (c) =>
        c
          .meta({ description: "List currently applied CRDs" })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            const url = await getSiteApiUrl()
            const res = await fetch(`${url}/api/v1/site/crds`)
            if (!res.ok) exitWithError(f, `Site API error: ${res.status}`)
            const data = await res.json()
            tableOrJson(
              flags,
              data,
              ["Name", "Group", "Version", "Kind"],
              (r) => [
                styleBold(String(r.name ?? "")),
                String(r.group ?? ""),
                String(r.version ?? ""),
                String(r.kind ?? ""),
              ],
              undefined,
              { emptyMessage: "No CRDs applied." }
            )
          })
      )
  )
}

async function getSiteApiUrl(): Promise<string> {
  const config = await readConfig()
  const siteUrl = resolveSiteUrl(config)
  return siteUrl || resolveFactoryUrl(config)
}
