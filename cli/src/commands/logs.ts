import { existsSync } from "node:fs"
import { join } from "node:path"

import type { DxBase } from "../dx-root.js"
import { getFactoryClient } from "../client.js"
import { isDockerRunning } from "../lib/docker.js"
import { streamDockerLogs, parseDockerLogLine } from "../lib/docker-logs.js"
import { formatLogEntry, formatLogEntryJson } from "../lib/log-formatter.js"
import { toDxFlags } from "./dx-flags.js"

export function logsCommand(app: DxBase) {
  return app
    .sub("logs")
    .meta({ description: "Stream or fetch logs" })
    .args([
      {
        name: "module",
        type: "string",
        description: "Module name (or host for infra logs)",
      },
      {
        name: "component",
        type: "string",
        description: "Component name",
      },
    ])
    .flags({
      follow: {
        type: "boolean",
        short: "f",
        description: "Follow (stream) logs in real time",
      },
      since: {
        type: "string",
        description: "Start time (ISO-8601 or duration: 5m, 1h)",
      },
      until: {
        type: "string",
        description: "End time (ISO-8601 or duration)",
      },
      around: {
        type: "string",
        description: "Center timestamp for windowed query",
      },
      window: {
        type: "string",
        description: "Window size around --around (default 5m)",
      },
      level: {
        type: "string",
        description: "Filter by level: error,warn,info,debug (comma-separated)",
      },
      grep: {
        type: "string",
        description: "Text search filter",
      },
      site: {
        type: "string",
        description: "Target site",
      },
      sandbox: {
        type: "string",
        description: "Target sandbox",
      },
      build: {
        type: "string",
        description: "Build ID (fetch build logs)",
      },
      rollout: {
        type: "string",
        description: "Rollout ID (fetch rollout logs)",
      },
      unit: {
        type: "string",
        description: "Systemd unit (for host/infra logs)",
      },
      limit: {
        type: "number",
        description: "Max entries to return",
      },
      tail: {
        type: "number",
        description: "Number of recent lines to show (local Docker only)",
      },
    })
    .run(async ({ args, flags }) => {
      const f = toDxFlags(flags)
      const isRemote = !!(flags.site || flags.sandbox || flags.build || flags.rollout)

      try {
        if (isRemote) {
          await fetchRemoteLogs(args, flags, f)
        } else if (shouldUseLocalDocker()) {
          await streamLocalLogs(args, flags, f)
        } else {
          await fetchRemoteLogs(args, flags, f)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`Error: ${msg}`)
        process.exit(1)
      }
    })
}

function shouldUseLocalDocker(): boolean {
  const composePath = join(process.cwd(), ".dx", "generated", "docker-compose.yaml")
  return isDockerRunning() && existsSync(composePath)
}

async function streamLocalLogs(
  args: { module?: string; component?: string },
  flags: Record<string, unknown>,
  f: { json?: boolean }
) {
  const composePath = join(process.cwd(), ".dx", "generated", "docker-compose.yaml")
  const ac = new AbortController()

  // Filter to specific services if module/component given
  const services: string[] = []
  if (args.component) services.push(args.component)
  else if (args.module) services.push(args.module)

  const levelFilter = flags.level
    ? new Set((flags.level as string).split(",").map((l) => l.trim().toLowerCase()))
    : null
  const grepFilter = flags.grep ? (flags.grep as string).toLowerCase() : null

  process.on("SIGINT", () => ac.abort())

  await streamDockerLogs(
    {
      composeFile: composePath,
      services: services.length > 0 ? services : undefined,
      follow: !!flags.follow,
      since: flags.since as string | undefined,
      tail: (flags.tail as number) ?? (flags.follow ? 10 : undefined),
      signal: ac.signal,
    },
    (entry) => {
      if (levelFilter && !levelFilter.has(entry.level)) return
      if (grepFilter && !entry.message.toLowerCase().includes(grepFilter)) return

      if (f.json) {
        console.log(formatLogEntryJson(entry))
      } else {
        console.log(formatLogEntry(entry))
      }
    }
  )
}

async function fetchRemoteLogs(
  args: { module?: string; component?: string },
  flags: Record<string, unknown>,
  f: { json?: boolean }
) {
  const client = await getFactoryClient()
  const query: Record<string, string | undefined> = {
    module: args.module,
    component: args.component,
    site: flags.site as string | undefined,
    sandbox: flags.sandbox as string | undefined,
    level: flags.level as string | undefined,
    grep: flags.grep as string | undefined,
    since: flags.since as string | undefined,
    until: flags.until as string | undefined,
    around: flags.around as string | undefined,
    window: flags.window as string | undefined,
    buildId: flags.build as string | undefined,
    rolloutId: flags.rollout as string | undefined,
    host: args.module,
    unit: flags.unit as string | undefined,
    limit: flags.limit ? String(flags.limit) : undefined,
  }

  // Remove undefined keys
  for (const k of Object.keys(query)) {
    if (query[k] === undefined) delete query[k]
  }

  if (flags.follow) {
    // Polling follow mode with cursor
    let cursor: string | undefined
    const ac = new AbortController()
    process.on("SIGINT", () => ac.abort())

    while (!ac.signal.aborted) {
      const res = await client.api.v1.factory.observability.logs.get({
        query: { ...query, cursor },
      })
      if (res.error) throw new Error(String(res.error))
      const body = res.data
      if (body.entries?.length) {
        for (const entry of body.entries) {
          if (f.json) {
            console.log(formatLogEntryJson(entry))
          } else {
            console.log(formatLogEntry(entry))
          }
        }
      }
      cursor = body.cursor
      if (!body.hasMore) {
        await new Promise((r) => setTimeout(r, 2000))
      }
    }
  } else {
    const res = await client.api.v1.factory.observability.logs.get({ query })
    if (res.error) throw new Error(String(res.error))
    const body = res.data
    if (!body.entries?.length) {
      console.log("No log entries found.")
      return
    }
    for (const entry of body.entries) {
      if (f.json) {
        console.log(formatLogEntryJson(entry))
      } else {
        console.log(formatLogEntry(entry))
      }
    }
    if (body.hasMore) {
      console.log(`\n... more entries available (use --limit to increase)`)
    }
  }
}
