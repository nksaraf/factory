import type { DxBase } from "../dx-root.js"

import { getFactoryClient } from "../client.js"
import { apiCall, tableOrJson, colorStatus, timeAgo } from "./list-helpers.js"
import { setExamples } from "../plugins/examples-plugin.js"

setExamples("ci", [
  "$ dx ci run                              Run all workflows locally via act",
  "$ dx ci run --workflow ci.yml            Run a specific workflow",
  "$ dx ci run --job test                   Run a specific job",
  "$ dx ci run --list                       List available workflows",
  "$ dx ci run --event pull_request         Simulate a pull_request event",
])

export function ciCommand(app: DxBase) {
  return (
    app
      .sub("ci")
      .meta({ description: "Run CI workflows locally" })

      // --- run ---
      .command("run", (c) =>
        c
          .meta({ description: "Run GitHub Actions workflows locally via act" })
          .flags({
            workflow: {
              type: "string",
              alias: "w",
              description: "Specific workflow file (e.g. ci.yml)",
            },
            job: {
              type: "string",
              alias: "j",
              description: "Specific job name to run",
            },
            secret: {
              type: "string",
              alias: "s",
              description: "Secret KEY=VALUE (repeatable)",
            },
            "env-file": {
              type: "string",
              description: "Path to .env file (default: .env if exists)",
            },
            platform: {
              type: "string",
              description:
                "Act platform image override (e.g. ubuntu-latest=catthehacker/ubuntu:act-latest)",
            },
            event: {
              type: "string",
              alias: "e",
              description: "Event type to simulate (default: push)",
            },
            list: {
              type: "boolean",
              alias: "l",
              description: "List available workflows and jobs (dry run)",
            },
            verbose: {
              type: "boolean",
              alias: "v",
              description: "Verbose output",
            },
          })
          .run(async ({ flags }) => {
            const { detectEnvironment } =
              await import("../lib/ci/environment.js")
            const env = detectEnvironment()

            if (env === "github-actions") {
              console.log(
                "Already running in GitHub Actions — workflows execute natively."
              )
              console.log(
                "Use `dx ci status` to check run status from the API."
              )
              return
            }

            const { runWithAct } = await import("../lib/ci/act-runner.js")

            const secrets = flags.secret
              ? Array.isArray(flags.secret)
                ? (flags.secret as string[])
                : [flags.secret as string]
              : undefined

            const exitCode = await runWithAct({
              workflow: flags.workflow as string | undefined,
              job: flags.job as string | undefined,
              secrets,
              envFile: flags["env-file"] as string | undefined,
              platform: flags.platform as string | undefined,
              event: flags.event as string | undefined,
              list: flags.list as boolean | undefined,
              verbose: flags.verbose as boolean | undefined,
            })

            if (exitCode !== 0) {
              process.exit(exitCode)
            }
          })
      )

      // --- status ---
      .command("status", (c) =>
        c
          .meta({ description: "Show recent CI pipeline run status" })
          .flags({
            repo: {
              type: "string",
              description: "Filter by repo",
            },
            branch: {
              type: "string",
              description: "Filter by branch",
            },
            status: {
              type: "string",
              description:
                "Filter by status (pending, running, success, failure, cancelled)",
            },
            limit: {
              type: "number",
              alias: "n",
              description: "Number of results (default: 10)",
            },
          })
          .run(async ({ flags }) => {
            // @ts-ignore TS2589 — Elysia Treaty type exceeds TS recursion limit
            const api = await getFactoryClient()

            const query: Record<string, unknown> = {}
            if (flags.repo) query.repoId = flags.repo
            if (flags.branch) query.triggerRef = flags.branch
            if (flags.status) query.status = flags.status
            query.limit = (flags.limit as number) ?? 10
            query.offset = 0

            const data = await apiCall(flags, () =>
              api.api.v1.factory.build["pipeline-runs"].get({ query })
            )

            tableOrJson(
              flags,
              data,
              [
                "ID",
                "Status",
                "Event",
                "Ref",
                "SHA",
                "Workflow",
                "Started",
                "Duration",
              ],
              (run: Record<string, unknown>) => {
                const sha = String(run.commitSha ?? "").slice(0, 7)
                const ref = String(run.triggerRef ?? "")
                const started = timeAgo(run.startedAt as string | null)
                let duration = "-"
                if (run.startedAt && run.completedAt) {
                  const ms =
                    new Date(run.completedAt as string).getTime() -
                    new Date(run.startedAt as string).getTime()
                  const secs = Math.floor(ms / 1000)
                  if (secs < 60) duration = `${secs}s`
                  else if (secs < 3600)
                    duration = `${Math.floor(secs / 60)}m ${secs % 60}s`
                  else
                    duration = `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`
                }
                return [
                  String(run.pipelineRunId ?? ""),
                  colorStatus(String(run.status ?? "")),
                  String(run.triggerEvent ?? ""),
                  ref.length > 30 ? ref.slice(0, 27) + "..." : ref,
                  sha,
                  String(run.workflowFile ?? "-"),
                  started,
                  duration,
                ]
              },
              undefined,
              { emptyMessage: "No pipeline runs found." }
            )
          })
      )
  )
}
