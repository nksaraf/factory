import { getFactoryClient, getFactoryRestClient } from "../client.js"
import { readConfig } from "../config.js"
import type { DxBase } from "../dx-root.js"
import { setExamples } from "../plugins/examples-plugin.js"
import {
  type ColumnOpt,
  actionResult,
  apiCall,
  colorStatus,
  detailView,
  styleBold,
  styleError,
  styleMuted,
  styleSuccess,
  tableOrJson,
  timeAgo,
} from "./list-helpers.js"

setExamples("preview", [
  "$ dx preview deploy                Deploy preview from current branch",
  "$ dx preview list                  List active previews",
  "$ dx preview show my-preview       Show preview details",
  "$ dx preview status                Show preview for current branch",
  "$ dx preview extend my-preview     Extend preview TTL",
  "$ dx preview wait my-preview       Wait for preview to become active",
  "$ dx preview destroy my-preview    Tear down a preview",
  "$ dx preview open my-preview       Open preview URL in browser",
])

const PREVIEW_BASE = "/api/v1/factory/ops/previews"

async function getPreviewApi() {
  const api = await getFactoryClient()
  // Routes: /api/v1/factory/ops/previews/...
  return api.api.v1.factory.ops.previews
}

async function getPreviewDomain(): Promise<string> {
  const cfg = await readConfig()
  if (cfg.domain) return cfg.domain
  // Derive from factoryUrl: https://factory.lepton.software → lepton.software
  try {
    const host = new URL(cfg.factoryUrl).hostname
    const parts = host.split(".")
    if (parts.length > 2) return parts.slice(1).join(".")
    return host
  } catch {
    return "lepton.software"
  }
}

function previewUrl(slug: string, domain: string): string {
  return `https://${slug}.preview.${domain}`
}

export function previewCommand(app: DxBase) {
  return (
    app
      .sub("preview")
      .meta({ description: "Manage preview deployments" })

      // --- deploy ---
      .command("deploy", (c) =>
        c
          .meta({ description: "Deploy a preview from the current branch" })
          .flags({
            branch: {
              type: "string",
              alias: "b",
              description: "Source branch (default: current branch)",
            },
            repo: {
              type: "string",
              description: "Repository URL",
            },
            pr: {
              type: "number",
              description: "PR number",
            },
            site: {
              type: "string",
              description: "Site name for the preview",
            },
            "site-id": {
              type: "string",
              description: "Site ID",
            },
            "cluster-id": {
              type: "string",
              description: "Cluster ID to deploy to",
            },
            "owner-id": {
              type: "string",
              description: "Owner ID",
            },
            image: {
              type: "string",
              alias: "i",
              description: "Container image to deploy (skips build step)",
            },
            auth: {
              type: "string",
              description: "Auth mode (public|team|private, default: team)",
            },
            ttl: {
              type: "string",
              description: "TTL duration (e.g. 7d, 24h)",
            },
            wait: {
              type: "boolean",
              alias: "w",
              description: "Wait for preview to become active (default: true)",
            },
          })
          .run(async ({ flags }) => {
            // Detect current branch if not specified
            let branch = flags.branch as string | undefined
            if (!branch) {
              try {
                const { captureOrThrow } = await import("../lib/subprocess.js")
                const result = await captureOrThrow([
                  "git",
                  "rev-parse",
                  "--abbrev-ref",
                  "HEAD",
                ])
                branch = result.stdout.trim()
              } catch {
                console.error(
                  "Could not detect current branch. Use --branch to specify."
                )
                process.exit(1)
              }
            }

            // Get current commit SHA
            let commitSha = ""
            try {
              const { captureOrThrow } = await import("../lib/subprocess.js")
              const result = await captureOrThrow(["git", "rev-parse", "HEAD"])
              commitSha = result.stdout.trim()
            } catch {
              commitSha = "unknown"
            }

            // Get repo URL if not specified
            let repo = flags.repo as string | undefined
            if (!repo) {
              try {
                const { captureOrThrow } = await import("../lib/subprocess.js")
                const result = await captureOrThrow([
                  "git",
                  "remote",
                  "get-url",
                  "origin",
                ])
                repo = result.stdout.trim()
              } catch {
                // repo is optional in the API
              }
            }

            const siteName = (flags.site as string) ?? "default"

            const body: Record<string, unknown> = {
              name: `preview-${branch}`,
              sourceBranch: branch,
              commitSha,
              repo: repo ?? "",
              siteName,
              ownerId: flags["owner-id"] ?? "cli-user",
              createdBy: flags["owner-id"] ?? "cli-user",
            }
            if (flags.pr != null) body.prNumber = flags.pr
            if (flags["site-id"]) body.siteId = flags["site-id"]
            if (flags["cluster-id"]) body.clusterId = flags["cluster-id"]
            if (flags.auth) body.authMode = flags.auth
            if (flags.image) body.imageRef = flags.image

            const rest = await getFactoryRestClient()
            const result = await rest.request<{
              data?: Record<string, unknown>
            }>("POST", PREVIEW_BASE, body)

            const resultData = result?.data
            const previewData = (
              resultData?.preview && typeof resultData.preview === "object"
                ? resultData.preview
                : undefined
            ) as Record<string, unknown> | undefined
            if (!previewData?.slug) {
              actionResult(flags, result, styleSuccess("Preview created."))
              return
            }

            const slug = previewData.slug as string
            const domain = (
              (resultData?.route && typeof resultData.route === "object"
                ? resultData.route
                : undefined) as Record<string, unknown> | undefined
            )?.domain as string | undefined
            const shouldWait = flags.wait !== false

            if (shouldWait) {
              process.stdout.write(styleMuted("Deploying preview..."))
              const maxWait = 120_000
              const interval = 3_000
              const start = Date.now()
              let status = "pending_image"

              while (
                Date.now() - start < maxWait &&
                !["active", "failed", "expired"].includes(status)
              ) {
                await new Promise((r) => setTimeout(r, interval))
                try {
                  const poll = await rest.request<{
                    data?: Record<string, unknown>
                  }>("GET", `${PREVIEW_BASE}/${slug}`)
                  status = (poll?.data?.status as string) ?? status
                } catch {
                  // ignore transient errors
                }
                process.stdout.write(".")
              }
              console.log()

              if (status === "active") {
                console.log(styleSuccess(`Preview "${slug}" is active.`))
                if (domain) {
                  console.log(styleMuted(`  URL: https://${domain}`))
                }
              } else {
                console.log(styleMuted(`Preview status: ${status}`))
              }
            } else {
              console.log(
                styleSuccess(
                  `Preview "${slug}" created (deploying in background).`
                )
              )
              if (domain) {
                console.log(styleMuted(`  URL: https://${domain}`))
              }
            }
          })
      )

      // --- list ---
      .command("list", (c) =>
        c
          .meta({ description: "List previews" })
          .flags({
            all: {
              type: "boolean",
              alias: "a",
              description: "Include expired/inactive previews",
            },
            status: {
              type: "string",
              alias: "s",
              description: "Filter by status",
            },
            repo: {
              type: "string",
              description: "Filter by repo",
            },
            branch: {
              type: "string",
              description: "Filter by source branch",
            },
            "site-id": {
              type: "string",
              description: "Filter by site ID",
            },
          })
          .run(async ({ flags }) => {
            const api = await getPreviewApi()
            const query: Record<string, string | undefined> = {}
            if (!flags.all && !flags.status) query.status = "active"
            if (flags.status) query.status = flags.status as string
            if (flags.repo) query.repo = flags.repo as string
            if (flags.branch) query.sourceBranch = flags.branch as string
            if (flags["site-id"]) query.siteId = flags["site-id"] as string

            const result = await apiCall(flags, () => api.get({ query }))
            const colOpts: ColumnOpt[] = [{}, {}, {}, {}, {}, {}, {}]
            tableOrJson(
              flags,
              result,
              ["Slug", "Branch", "PR", "Status", "Runtime", "Repo", "Created"],
              (r) => [
                styleBold(String(r.slug ?? "")),
                String(r.sourceBranch ?? ""),
                r.prNumber ? `#${r.prNumber}` : "-",
                colorStatus(String(r.status ?? "")),
                String(r.runtimeClass ?? ""),
                styleMuted(String(r.repo ?? "").replace(/.*\//, "")),
                timeAgo(r.createdAt as string),
              ],
              colOpts,
              { emptyMessage: "No previews found." }
            )
          })
      )

      // --- show ---
      .command("show", (c) =>
        c
          .meta({ description: "Show preview details" })
          .args([
            {
              name: "slug",
              type: "string",
              required: true,
              description: "Preview slug",
            },
          ])
          .run(async ({ args, flags }) => {
            const rest = await getFactoryRestClient()
            const domain = await getPreviewDomain()
            const result = await rest.request<{
              data?: Record<string, unknown>
            }>("GET", `${PREVIEW_BASE}/${args.slug}`)
            const r = result?.data
            const f = { ...flags }
            if ((f as Record<string, unknown>).json) {
              console.log(JSON.stringify({ success: true, data: r }, null, 2))
              return
            }
            if (!r) {
              console.log("Not found.")
              return
            }
            const fields: [string, string][] = [
              ["ID", styleMuted(String(r.previewId ?? ""))],
              ["Slug", styleBold(String(r.slug ?? ""))],
              ["Branch", String(r.sourceBranch ?? "")],
              ["PR", r.prNumber ? `#${r.prNumber}` : "-"],
              ["Commit", styleMuted(String(r.commitSha ?? "").slice(0, 8))],
              ["Repo", String(r.repo ?? "")],
              ["Status", colorStatus(String(r.status ?? ""))],
              ["Runtime", String(r.runtimeClass ?? "")],
              ["Auth", String(r.authMode ?? "")],
              ["Owner", String(r.ownerId ?? "")],
              ["URL", previewUrl(String(r.slug), domain)],
              ["Expires", r.expiresAt ? timeAgo(r.expiresAt as string) : "-"],
              ["Created", timeAgo(r.createdAt as string)],
            ]
            const maxLabel = Math.max(...fields.map(([l]) => l.length))
            for (const [label, value] of fields) {
              console.log(`${styleMuted(label.padEnd(maxLabel))}  ${value}`)
            }
          })
      )

      // --- destroy ---
      .command("destroy", (c) =>
        c
          .meta({ description: "Destroy a preview" })
          .args([
            {
              name: "slug",
              type: "string",
              required: true,
              description: "Preview slug",
            },
          ])
          .run(async ({ args, flags }) => {
            const api = await getPreviewApi()
            const result = await apiCall(flags, () =>
              api({ slugOrId: args.slug }).delete.post()
            )
            actionResult(
              flags,
              result,
              styleSuccess(`Preview "${args.slug}" destroyed.`)
            )
          })
      )

      // --- open ---
      .command("open", (c) =>
        c
          .meta({ description: "Open preview URL in browser" })
          .args([
            {
              name: "slug",
              type: "string",
              required: true,
              description: "Preview slug",
            },
          ])
          .run(async ({ args }) => {
            const domain = await getPreviewDomain()
            const url = previewUrl(args.slug, domain)
            const { exec: execCmd } = await import("../lib/subprocess.js")
            const openCmd = process.platform === "darwin" ? "open" : "xdg-open"
            try {
              await execCmd([openCmd, url])
            } catch {
              console.log(`Open in browser: ${url}`)
            }
          })
      )

      // --- status (auto-detect from current branch) ---
      .command("status", (c) =>
        c
          .meta({ description: "Show preview status for current branch" })
          .flags({
            repo: {
              type: "string",
              description: "Filter by repo",
            },
          })
          .run(async ({ flags }) => {
            // Detect current branch
            let branch: string
            try {
              const { captureOrThrow } = await import("../lib/subprocess.js")
              const result = await captureOrThrow([
                "git",
                "rev-parse",
                "--abbrev-ref",
                "HEAD",
              ])
              branch = result.stdout.trim()
            } catch {
              console.error("Could not detect current branch.")
              process.exit(1)
            }

            const rest = await getFactoryRestClient()
            const domain = await getPreviewDomain()
            const params = new URLSearchParams({ sourceBranch: branch })
            if (flags.repo) params.set("repo", flags.repo as string)

            const result = await rest.request<{
              data?: Record<string, unknown>[]
            }>("GET", `${PREVIEW_BASE}?${params.toString()}`)
            const previews = Array.isArray(result?.data) ? result.data : []

            if (previews.length === 0) {
              console.log(
                styleMuted(`No previews found for branch "${branch}".`)
              )
              return
            }

            for (const p of previews) {
              const status = colorStatus(String(p.status ?? ""))
              const url = previewUrl(String(p.slug), domain)
              console.log(`${styleBold(String(p.slug))}  ${status}`)
              console.log(
                `  Branch: ${p.sourceBranch}  Commit: ${styleMuted(String(p.commitSha ?? "").slice(0, 7))}`
              )
              if (p.status === "active") {
                console.log(`  URL:    ${url}`)
              }
              if (p.imageRef) {
                console.log(`  Image:  ${styleMuted(String(p.imageRef))}`)
              }
              if (p.expiresAt) {
                console.log(`  Expires: ${timeAgo(p.expiresAt as string)}`)
              }
            }
          })
      )

      // --- extend ---
      .command("extend", (c) =>
        c
          .meta({ description: "Extend preview TTL" })
          .args([
            {
              name: "slug",
              type: "string",
              required: true,
              description: "Preview slug",
            },
          ])
          .flags({
            days: {
              type: "number",
              alias: "d",
              description: "Number of days to extend (default: 7)",
            },
          })
          .run(async ({ args, flags }) => {
            const days = (flags.days as number | undefined) ?? 7
            const rest = await getFactoryRestClient()
            const result = await rest.request(
              "POST",
              `${PREVIEW_BASE}/${args.slug}/extend`,
              { days }
            )
            actionResult(
              flags,
              result,
              styleSuccess(`Preview "${args.slug}" extended by ${days} days.`)
            )
          })
      )

      // --- wait ---
      .command("wait", (c) =>
        c
          .meta({ description: "Wait for preview to become active" })
          .args([
            {
              name: "slug",
              type: "string",
              required: true,
              description: "Preview slug",
            },
          ])
          .flags({
            timeout: {
              type: "number",
              alias: "t",
              description: "Timeout in seconds (default: 300)",
            },
          })
          .run(async ({ args, flags }) => {
            const timeoutMs =
              ((flags.timeout as number | undefined) ?? 300) * 1000
            const interval = 3_000
            const start = Date.now()
            const rest = await getFactoryRestClient()
            const domain = await getPreviewDomain()

            process.stdout.write(
              styleMuted(`Waiting for preview "${args.slug}"...`)
            )

            let status = "unknown"
            while (Date.now() - start < timeoutMs) {
              try {
                const poll = await rest.request<{
                  data?: Record<string, unknown>
                }>("GET", `${PREVIEW_BASE}/${args.slug}`)
                status = (poll?.data?.status as string) ?? status
              } catch {
                // transient error
              }

              if (status === "active") {
                console.log()
                console.log(styleSuccess(`Preview "${args.slug}" is active.`))
                console.log(
                  styleMuted(`  URL: ${previewUrl(args.slug, domain)}`)
                )
                process.exit(0)
              }
              if (status === "failed" || status === "expired") {
                console.log()
                console.log(styleError(`Preview "${args.slug}" ${status}.`))
                process.exit(1)
              }

              process.stdout.write(".")
              await new Promise((r) => setTimeout(r, interval))
            }

            console.log()
            console.log(
              styleError(
                `Timeout waiting for preview. Current status: ${status}`
              )
            )
            process.exit(1)
          })
      )

      // --- logs ---
      .command("logs", (c) =>
        c
          .meta({ description: "Show preview deployment logs" })
          .args([
            {
              name: "slug",
              type: "string",
              required: true,
              description: "Preview slug",
            },
          ])
          .run(async ({ args, flags }) => {
            const rest = await getFactoryRestClient()
            const result = await rest.request<{
              data?: Record<string, unknown>
            }>("GET", `${PREVIEW_BASE}/${args.slug}`)
            const p = result?.data

            if (!p) {
              console.error(`Preview "${args.slug}" not found.`)
              process.exit(1)
            }

            console.log(styleBold(`Preview: ${p.slug}`))
            console.log(`Status:  ${colorStatus(String(p.status ?? ""))}`)
            console.log(
              `Branch:  ${p.sourceBranch}  Commit: ${String(p.commitSha ?? "").slice(0, 7)}`
            )
            if (p.imageRef) console.log(`Image:   ${p.imageRef}`)
            if (p.statusMessage) {
              console.log()
              console.log(styleBold("Status Message:"))
              console.log(p.statusMessage)
            }
          })
      )
  )
}
