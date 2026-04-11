import { getFactoryRestClient } from "../client.js"
import type { DxBase } from "../dx-root.js"
import { printKeyValue, printTable } from "../output.js"
import { setExamples } from "../plugins/examples-plugin.js"
import {
  styleBold,
  styleError,
  styleMuted,
  styleSuccess,
} from "./list-helpers.js"

setExamples("workflow", [
  "$ dx workflow list                                List available workflows",
  '$ dx workflow start god-workflow --input \'{"issueKey":"PROJ-1",...}\'  Start a workflow',
  "$ dx workflow runs                                List workflow runs",
  "$ dx workflow runs --status running               Filter runs by status",
  "$ dx workflow status <run-id>                     Get run details",
  "$ dx workflow cancel <run-id>                     Cancel a run",
  '$ dx workflow emit workbench.ready --data \'{"workbenchId":"wb-123","status":"active"}\'  Emit event',
  "$ dx workflow subs                                List pending event subscriptions",
  "$ dx workflow subs --run-id wfr_xxx               Filter subs by run ID",
])

export function workflowCommand(app: DxBase) {
  return (
    app
      .sub("workflow")
      .meta({ description: "Manage durable workflows" })

      // ── dx workflow list ──
      .command("list", (c) =>
        c
          .meta({ description: "List available workflow definitions" })
          .run(async ({ flags }) => {
            const json = flags.json as boolean | undefined
            const client = await getFactoryRestClient()
            const res = await client.request<{
              data: Array<{
                name: string
                description: string
                triggerTypes: string[]
              }>
            }>("GET", "/api/factory/workflow/definitions")

            if (json) {
              console.log(JSON.stringify(res.data, null, 2))
              return
            }

            if (res.data.length === 0) {
              console.log(styleMuted("No workflow definitions registered."))
              return
            }

            printTable(
              ["Name", "Description", "Triggers"],
              res.data.map((d) => [
                styleBold(d.name),
                d.description,
                d.triggerTypes.join(", "),
              ])
            )
          })
      )

      // ── dx workflow start <name> ──
      .command("start", (c) =>
        c
          .meta({ description: "Start a workflow run" })
          .args([
            {
              name: "name",
              type: "string",
              required: true,
              description: "Workflow name",
            },
          ])
          .flags({
            input: {
              type: "string",
              short: "i",
              description: "JSON input for the workflow",
            },
          })
          .run(async ({ args, flags }) => {
            const json = flags.json as boolean | undefined
            const name = args.name as string
            const inputStr = (flags.input as string) ?? "{}"

            let input: Record<string, unknown>
            try {
              input = JSON.parse(inputStr)
            } catch {
              console.error(styleError("Invalid JSON input"))
              process.exit(1)
            }

            const client = await getFactoryRestClient()
            const res = await client.request<{
              success: boolean
              workflowRunId?: string
              error?: string
            }>("POST", "/api/factory/workflow/runs", {
              workflowName: name,
              input,
            })

            if (json) {
              console.log(JSON.stringify(res, null, 2))
              return
            }

            if (res.success) {
              console.log(
                styleSuccess(`Workflow started: ${res.workflowRunId}`)
              )
            } else {
              console.error(styleError(`Failed: ${res.error}`))
              process.exit(1)
            }
          })
      )

      // ── dx workflow runs ──
      .command("runs", (c) =>
        c
          .meta({ description: "List workflow runs" })
          .flags({
            status: {
              type: "string",
              short: "s",
              description:
                "Filter by status (running, succeeded, failed, cancelled)",
            },
            workflow: {
              type: "string",
              short: "w",
              description: "Filter by workflow name",
            },
            limit: {
              type: "string",
              short: "l",
              description: "Max results (default 50)",
            },
          })
          .run(async ({ flags }) => {
            const json = flags.json as boolean | undefined
            const params = new URLSearchParams()
            if (flags.status) params.set("status", flags.status as string)
            if (flags.workflow)
              params.set("workflowName", flags.workflow as string)
            if (flags.limit) params.set("limit", flags.limit as string)

            const qs = params.toString() ? `?${params.toString()}` : ""
            const client = await getFactoryRestClient()
            const res = await client.request<{ data: any[] }>(
              "GET",
              `/api/factory/workflow/runs${qs}`
            )

            if (json) {
              console.log(JSON.stringify(res.data, null, 2))
              return
            }

            if (res.data.length === 0) {
              console.log(styleMuted("No workflow runs found."))
              return
            }

            printTable(
              ["ID", "Workflow", "Status", "Phase", "Created"],
              res.data.map((r: any) => [
                r.workflowRunId,
                r.workflowName,
                formatStatus(r.status),
                r.phase,
                formatDate(r.createdAt),
              ])
            )
          })
      )

      // ── dx workflow status <run-id> ──
      .command("status", (c) =>
        c
          .meta({ description: "Get workflow run details" })
          .args([
            {
              name: "id",
              type: "string",
              required: true,
              description: "Workflow run ID",
            },
          ])
          .run(async ({ args, flags }) => {
            const json = flags.json as boolean | undefined
            const client = await getFactoryRestClient()
            const res = await client.request<{ data: any }>(
              "GET",
              `/api/factory/workflow/runs/${args.id}`
            )

            if (json) {
              console.log(JSON.stringify(res.data, null, 2))
              return
            }

            const r = res.data
            console.log(
              printKeyValue({
                "Run ID": r.workflowRunId,
                Workflow: r.workflowName,
                Status: r.status,
                Phase: r.phase,
                Trigger: r.trigger,
                Created: formatDate(r.createdAt),
                Updated: formatDate(r.updatedAt),
                Completed: r.completedAt
                  ? formatDate(r.completedAt)
                  : undefined,
                Error: r.error || undefined,
              })
            )

            if (r.state && Object.keys(r.state).length > 0) {
              console.log("\n" + styleBold("State:"))
              console.log(JSON.stringify(r.state, null, 2))
            }
          })
      )

      // ── dx workflow cancel <run-id> ──
      .command("cancel", (c) =>
        c
          .meta({ description: "Cancel a workflow run" })
          .args([
            {
              name: "id",
              type: "string",
              required: true,
              description: "Workflow run ID",
            },
          ])
          .run(async ({ args, flags }) => {
            const json = flags.json as boolean | undefined
            const client = await getFactoryRestClient()
            const res = await client.request<{
              success: boolean
              error?: string
            }>("POST", `/api/factory/workflow/runs/${args.id}/cancel`)

            if (json) {
              console.log(JSON.stringify(res, null, 2))
              return
            }

            if (res.success) {
              console.log(styleSuccess(`Run ${args.id} cancelled.`))
            } else {
              console.error(styleError(`Failed: ${res.error}`))
              process.exit(1)
            }
          })
      )

      // ── dx workflow emit <event-name> ──
      .command("emit", (c) =>
        c
          .meta({
            description:
              "Emit a workflow event (for testing / manual progression)",
          })
          .args([
            {
              name: "eventName",
              type: "string",
              required: true,
              description: "Event name (e.g. workbench.ready, pr.opened)",
            },
          ])
          .flags({
            data: {
              type: "string",
              short: "d",
              description: "JSON event data",
            },
          })
          .run(async ({ args, flags }) => {
            const json = flags.json as boolean | undefined
            const dataStr = (flags.data as string) ?? "{}"

            let data: Record<string, unknown>
            try {
              data = JSON.parse(dataStr)
            } catch {
              console.error(styleError("Invalid JSON data"))
              process.exit(1)
            }

            const client = await getFactoryRestClient()
            const res = await client.request<{
              success: boolean
              eventName: string
            }>("POST", "/api/factory/workflow/events", {
              eventName: args.eventName,
              data,
            })

            if (json) {
              console.log(JSON.stringify(res, null, 2))
              return
            }

            if (res.success) {
              console.log(styleSuccess(`Event emitted: ${args.eventName}`))
            } else {
              console.error(styleError("Failed to emit event"))
              process.exit(1)
            }
          })
      )

      // ── dx workflow subs ──
      .command("subs", (c) =>
        c
          .meta({ description: "List pending event subscriptions" })
          .flags({
            "run-id": {
              type: "string",
              short: "r",
              description: "Filter by workflow run ID",
            },
          })
          .run(async ({ flags }) => {
            const json = flags.json as boolean | undefined
            const params = new URLSearchParams()
            if (flags["run-id"])
              params.set("workflowRunId", flags["run-id"] as string)

            const qs = params.toString() ? `?${params.toString()}` : ""
            const client = await getFactoryRestClient()
            const res = await client.request<{ data: any[] }>(
              "GET",
              `/api/factory/workflow/subscriptions${qs}`
            )

            if (json) {
              console.log(JSON.stringify(res.data, null, 2))
              return
            }

            if (res.data.length === 0) {
              console.log(styleMuted("No pending event subscriptions."))
              return
            }

            printTable(
              ["Event", "Match Fields", "Run ID", "Expires"],
              res.data.map((s: any) => [
                styleBold(s.eventName),
                JSON.stringify(s.matchFields),
                s.workflowRunId,
                s.expiresAt ? formatDate(s.expiresAt) : styleMuted("never"),
              ])
            )
          })
      )
  )
}

function formatStatus(status: string): string {
  switch (status) {
    case "running":
      return "\x1b[34mrunning\x1b[0m"
    case "succeeded":
      return "\x1b[32msucceeded\x1b[0m"
    case "failed":
      return "\x1b[31mfailed\x1b[0m"
    case "cancelled":
      return "\x1b[33mcancelled\x1b[0m"
    default:
      return status
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}
