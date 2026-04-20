import { createReadStream, existsSync } from "node:fs"
import { basename, join } from "node:path"
import { createInterface } from "node:readline"

import { isDevComponent } from "@smp/factory-shared"

import { getFactoryClient } from "../client.js"
import { styleInfo, styleMuted } from "../cli-style.js"
import type { DxBase } from "../dx-root.js"
import { streamDockerLogs } from "../lib/docker-logs.js"
import { Compose } from "../lib/docker.js"
import { resolveDxContext } from "../lib/dx-context.js"
import type { LogSource } from "../lib/log-source.js"
import { formatLogEntry, formatLogEntryJson } from "../lib/log-formatter.js"
import { SshLogSource } from "../lib/ssh-log-source.js"
import { resolveUrl } from "../lib/trace-resolver.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { toDxFlags } from "./dx-flags.js"

setExamples("logs", [
  "$ dx logs --follow                              Stream live logs",
  "$ dx logs --level error --since 1h              Errors from last hour",
  '$ dx logs --grep "timeout"                      Search logs',
  "$ dx logs https://trafficure.com/admin/airflow  Logs for URL's resolved component",
])

export function logsCommand(app: DxBase) {
  return app
    .sub("logs")
    .meta({ description: "Stream or fetch logs" })
    .args([
      {
        name: "module",
        type: "string",
        description:
          "Module name, host, or URL (e.g. https://trafficure.com/admin/airflow)",
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
      workbench: {
        type: "string",
        description: "Target workbench",
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

      // URL mode: resolve via trace pipeline, then stream from resolved component
      const target = args.module
      if (target && target.includes("://")) {
        try {
          await streamUrlLogs(target, flags, f)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`Error: ${msg}`)
          process.exit(1)
        }
        return
      }

      const isRemote = !!(
        flags.site ||
        flags.workbench ||
        flags.build ||
        flags.rollout
      )

      try {
        if (isRemote) {
          await fetchRemoteLogs(args, flags, f)
        } else {
          const ctx = await resolveDxContext({ need: "project" }).catch(
            () => null
          )
          const service = args.component ?? args.module

          if (ctx?.project) {
            // 1. Devable component → check dev server log first
            const comp =
              service != null
                ? ctx.project.catalog.components[service]
                : undefined
            const isDevable = comp != null && isDevComponent(comp)
            if (isDevable) {
              const devLogPath = join(
                ctx.project.rootDir,
                ".dx",
                "dev",
                `${service}.log`
              )
              if (existsSync(devLogPath)) {
                await streamDevLog(devLogPath, flags, f)
                return
              }
            }

            // 2. Docker compose — if service is running (or no service filter)
            if (ctx.project.composeFiles.length > 0) {
              const compose = new Compose(
                ctx.project.composeFiles,
                basename(ctx.project.rootDir)
              )
              if (!service || compose.isRunning(service)) {
                await streamLocalLogs(compose, args, flags, f)
                return
              }
            }
          }

          // 3. Fall back to remote (Loki)
          await fetchRemoteLogs(args, flags, f)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`Error: ${msg}`)
        process.exit(1)
      }
    })
}

async function streamLocalLogs(
  compose: Compose,
  args: { module?: string; component?: string },
  flags: Record<string, unknown>,
  f: { json?: boolean }
) {
  const ac = new AbortController()

  // Filter to specific services if module/component given
  const services: string[] = []
  if (args.component) services.push(args.component)
  else if (args.module) services.push(args.module)

  const levelFilter = flags.level
    ? new Set(
        (flags.level as string).split(",").map((l) => l.trim().toLowerCase())
      )
    : null
  const grepFilter = flags.grep ? (flags.grep as string).toLowerCase() : null

  process.on("SIGINT", () => ac.abort())

  await streamDockerLogs(
    {
      compose,
      services: services.length > 0 ? services : undefined,
      follow: !!flags.follow,
      since: flags.since as string | undefined,
      tail: (flags.tail as number) ?? (flags.follow ? 10 : undefined),
      signal: ac.signal,
    },
    (entry) => {
      if (levelFilter && !levelFilter.has(entry.level)) return
      if (grepFilter && !entry.message.toLowerCase().includes(grepFilter))
        return

      if (f.json) {
        console.log(formatLogEntryJson(entry))
      } else {
        console.log(formatLogEntry(entry))
      }
    }
  )
}

async function streamDevLog(
  logPath: string,
  flags: Record<string, unknown>,
  _f: { json?: boolean }
) {
  const grepFilter = flags.grep ? (flags.grep as string).toLowerCase() : null
  const tail = flags.tail as number | undefined
  const follow = !!flags.follow

  const matchesFilter = (line: string) =>
    !grepFilter || line.toLowerCase().includes(grepFilter)

  // Read all lines from the file
  const readLines = (): Promise<string[]> => {
    const lines: string[] = []
    const rl = createInterface({ input: createReadStream(logPath) })
    return new Promise((resolve) => {
      rl.on("line", (line) => lines.push(line))
      rl.on("close", () => resolve(lines))
    })
  }

  const allLines = await readLines()
  const startLines = tail != null ? allLines.slice(-tail) : allLines
  for (const line of startLines) {
    if (matchesFilter(line)) console.log(line)
  }

  if (!follow) return

  // Follow mode: poll for new content by byte offset
  const { statSync } = await import("node:fs")
  let offset = statSync(logPath).size

  await new Promise<void>((resolve) => {
    const ac = new AbortController()
    process.on("SIGINT", () => {
      ac.abort()
      resolve()
    })

    const poll = () => {
      if (ac.signal.aborted) return
      const size = statSync(logPath).size
      if (size > offset) {
        const stream = createReadStream(logPath, { start: offset })
        const rl2 = createInterface({ input: stream })
        const newLines: string[] = []
        rl2.on("line", (line) => newLines.push(line))
        rl2.on("close", () => {
          for (const line of newLines) {
            if (matchesFilter(line)) console.log(line)
          }
          offset = size
          if (!ac.signal.aborted) setTimeout(poll, 300)
        })
      } else {
        if (!ac.signal.aborted) setTimeout(poll, 300)
      }
    }
    poll()
  })
}

async function streamUrlLogs(
  url: string,
  flags: Record<string, unknown>,
  f: { json?: boolean }
) {
  console.log(styleMuted(`Resolving ${url}…`))
  const resolved = await resolveUrl(url)

  let logSource: LogSource | undefined

  // Detect Traefik internal services before trying to stream
  const svc = resolved.serviceName ?? resolved.entitySlug
  if (svc.includes("@internal")) {
    console.error(
      `Resolved to Traefik internal service "${svc}" — this is not a real container.\n` +
        `The trace matched a catch-all route. Try a more specific URL or use:\n` +
        `  dx logs <compose-service-name> --host ${resolved.hostSlug ?? "<host>"}`
    )
    process.exit(1)
  }

  // Check local site context first
  const ctx = await resolveDxContext({ need: "project" }).catch(() => null)
  if (ctx?.project && ctx.project.composeFiles.length > 0) {
    const compose = new Compose(
      ctx.project.composeFiles,
      basename(ctx.project.rootDir)
    )
    if (compose.isRunning(svc)) {
      const { LocalLogSource } = await import("../lib/local-log-source.js")
      logSource = new LocalLogSource(compose, [svc])
    }
  }

  // Fall back to SSH log streaming on the resolved host
  if (!logSource && resolved.hostEntity && resolved.hostEntity.sshHost) {
    const project = resolved.composeProject ?? undefined
    const hostWithSsh = resolved.hostEntity as typeof resolved.hostEntity & {
      sshHost: string
    }
    logSource = new SshLogSource(hostWithSsh, project, svc)
  }

  if (!logSource) {
    console.error(
      `Could not resolve a log source for ${url} (resolved to ${resolved.entitySlug} on ${resolved.hostSlug ?? "unknown host"})`
    )
    process.exit(1)
  }

  console.log(styleInfo(`Streaming: ${logSource.label}`))

  const ac = new AbortController()
  process.on("SIGINT", () => ac.abort())

  await logSource.stream(
    {
      follow: !!flags.follow,
      since: flags.since as string | undefined,
      tail: (flags.tail as number) ?? (flags.follow ? 20 : 100),
      grep: flags.grep as string | undefined,
      level: flags.level as string | undefined,
      signal: ac.signal,
    },
    (entry) => {
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
    workbench: flags.workbench as string | undefined,
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
