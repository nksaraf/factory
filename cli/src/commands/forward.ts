import type { ChildProcess } from "node:child_process"

import type { DxBase } from "../dx-root.js"
import { exitWithError } from "../lib/cli-exit.js"
import { EntityFinder } from "../lib/entity-finder.js"
import {
  ForwardState,
  findFreePort,
  spawnSshForward,
} from "../lib/forward-state.js"
import { printTable } from "../output.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { toDxFlags } from "./dx-flags.js"
import {
  actionResult,
  colorStatus,
  styleBold,
  styleMuted,
  styleSuccess,
  styleWarn,
} from "./list-helpers.js"

setExamples("forward", [
  "$ dx forward staging:5432              Forward remote port to localhost",
  "$ dx forward staging:5432 --as 5433    Bind to different local port",
  "$ dx forward staging:5432 staging:3000 Forward multiple ports",
  "$ dx forward staging:5432 --bg         Forward in background (CLI exits)",
  "$ dx forward list                      List active forwards",
  "$ dx forward close abc123              Close a specific forward",
  "$ dx forward close --all               Close all forwards",
])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ParsedTarget {
  hostPart: string
  remotePort: number
}

function parseTarget(raw: string): ParsedTarget {
  const colonIdx = raw.lastIndexOf(":")
  if (colonIdx <= 0) {
    throw new Error(
      `Invalid target "${raw}". Expected format: host:port (e.g. staging:5432)`
    )
  }
  const hostPart = raw.slice(0, colonIdx)
  const remotePort = parseInt(raw.slice(colonIdx + 1), 10)
  if (isNaN(remotePort) || remotePort <= 0 || remotePort > 65535) {
    throw new Error(`Invalid port in "${raw}". Port must be 1-65535.`)
  }
  return { hostPart, remotePort }
}

interface ResolvedTarget {
  hostPart: string
  remotePort: number
  localPort: number
  sshHost: string
  sshPort: number
  sshUser?: string
  identityFile?: string
  jumpHost?: string
  jumpUser?: string
  jumpPort?: number
  displayName: string
}

async function resolveTarget(
  hostPart: string,
  remotePort: number,
  localPort: number,
  userOverride?: string,
  identityOverride?: string
): Promise<ResolvedTarget> {
  let sshHost = hostPart
  let sshPort = 22
  let sshUser = userOverride
  let identityFile = identityOverride
  let jumpHost: string | undefined
  let jumpUser: string | undefined
  let jumpPort: number | undefined
  let displayName = hostPart

  try {
    const finder = new EntityFinder()
    const entity = await finder.resolve(hostPart)
    if (entity?.sshHost) {
      sshHost = entity.sshHost
      sshPort = entity.sshPort ?? 22
      sshUser = sshUser ?? entity.sshUser ?? undefined
      identityFile = identityFile ?? entity.identityFile ?? undefined
      jumpHost = entity.jumpHost
      jumpUser = entity.jumpUser
      jumpPort = entity.jumpPort
      displayName = entity.displayName ?? hostPart
    }
  } catch {
    // EntityFinder unavailable — use raw hostname
  }

  return {
    hostPart,
    remotePort,
    localPort,
    sshHost,
    sshPort,
    sshUser,
    identityFile,
    jumpHost,
    jumpUser,
    jumpPort,
    displayName,
  }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export function forwardCommand(app: DxBase) {
  return (
    app
      .sub("forward")
      .meta({
        description: "Forward remote ports to localhost (SSH port forwarding)",
      })

      .args([
        {
          name: "targets",
          type: "string",
          variadic: true,
          description: "Remote targets as host:port (e.g. staging:5432)",
        },
      ])
      .flags({
        as: {
          type: "number",
          description:
            "Local port to bind (default: same as remote port, applies to first target)",
        },
        user: {
          type: "string",
          short: "l",
          description: "SSH user override",
        },
        identity: {
          type: "string",
          short: "i",
          description: "Path to SSH identity file",
        },
        bg: {
          type: "boolean",
          description: "Run in background (CLI exits, forward stays open)",
        },
      })
      .run(async ({ args, flags }) => {
        const f = toDxFlags(flags)
        const rawTargets = args.targets as string[] | undefined

        if (!rawTargets || rawTargets.length === 0) {
          exitWithError(
            f,
            "Usage: dx forward <host>:<port> [<host>:<port> ...]\n  Example: dx forward staging:5432"
          )
        }

        // Parse all targets
        const parsed: ParsedTarget[] = []
        for (const raw of rawTargets) {
          try {
            parsed.push(parseTarget(raw))
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err))
          }
        }

        // Resolve local ports (--as only applies to first target)
        const resolved: ResolvedTarget[] = []
        for (let i = 0; i < parsed.length; i++) {
          const { hostPart, remotePort } = parsed[i]
          const preferred =
            i === 0 && flags.as != null ? (flags.as as number) : remotePort
          const explicit = i === 0 && flags.as != null

          let localPort: number
          try {
            localPort = await findFreePort(preferred, explicit)
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err))
          }

          if (localPort !== preferred && !explicit) {
            console.error(
              styleWarn(
                `  Port ${preferred} in use, using ${localPort} instead`
              )
            )
          }

          const target = await resolveTarget(
            hostPart,
            remotePort,
            localPort,
            flags.user as string | undefined,
            flags.identity as string | undefined
          )
          resolved.push(target)
        }

        // Spawn SSH forwards
        const background = !!flags.bg
        const state = new ForwardState()
        const children: ChildProcess[] = []
        const ids: string[] = []

        for (const t of resolved) {
          const child = spawnSshForward({
            sshHost: t.sshHost,
            sshPort: t.sshPort,
            sshUser: t.sshUser,
            identityFile: t.identityFile,
            jumpHost: t.jumpHost,
            jumpUser: t.jumpUser,
            jumpPort: t.jumpPort,
            localPort: t.localPort,
            remotePort: t.remotePort,
            background,
          })

          if (!child.pid) {
            exitWithError(
              f,
              `Failed to spawn SSH process for ${t.displayName}:${t.remotePort}`
            )
          }

          children.push(child)

          const id = state.add({
            pid: child.pid,
            localPort: t.localPort,
            remotePort: t.remotePort,
            remoteHost: t.sshHost,
            displayName: t.displayName,
            startedAt: new Date().toISOString(),
          })
          ids.push(id)
        }

        // Output
        if (f.json) {
          console.log(
            JSON.stringify(
              {
                success: true,
                background,
                data: resolved.map((t, i) => ({
                  id: ids[i],
                  remote: { host: t.displayName, port: t.remotePort },
                  local: { port: t.localPort },
                  sshHost: t.sshHost,
                  sshPort: t.sshPort,
                  pid: children[i].pid,
                })),
              },
              null,
              2
            )
          )
        } else if (resolved.length === 1) {
          const t = resolved[0]
          console.log("")
          console.log(
            `  ${styleSuccess("Forward open.")}  ${styleMuted(`(id: ${ids[0]})`)}`
          )
          console.log(`  Remote: ${styleBold(t.displayName)}:${t.remotePort}`)
          console.log(`  Local:  ${styleBold(`localhost:${t.localPort}`)}`)
          console.log("")
          if (background) {
            console.log(
              styleMuted(
                `  Running in background (pid ${children[0].pid}). Use 'dx forward close ${ids[0]}' to stop.`
              )
            )
          } else {
            console.log(styleMuted("  Press Ctrl+C to close."))
          }
          console.log("")
        } else {
          console.log("")
          console.log(`  ${styleSuccess(`${resolved.length} forwards open.`)}`)
          console.log("")
          console.log(
            printTable(
              ["ID", "Host", "Remote", "Local"],
              resolved.map((t, i) => [
                ids[i],
                t.displayName,
                String(t.remotePort),
                `localhost:${t.localPort}`,
              ])
            )
          )
          console.log("")
          if (background) {
            console.log(
              styleMuted(
                "  Running in background. Use 'dx forward close --all' to stop."
              )
            )
          } else {
            console.log(styleMuted("  Press Ctrl+C to close all."))
          }
          console.log("")
        }

        // Background mode: brief liveness check, then CLI exits
        if (background) {
          // Wait up to 2s to catch immediate SSH failures (bad creds, unreachable host)
          await new Promise((resolve) => setTimeout(resolve, 1500))
          const dead: number[] = []
          for (let i = 0; i < children.length; i++) {
            try {
              process.kill(children[i].pid!, 0)
            } catch {
              dead.push(i)
            }
          }
          if (dead.length > 0) {
            for (const i of dead) state.remove(ids[i])
            if (dead.length === children.length) {
              exitWithError(
                f,
                "All SSH forwards failed to start. Check host connectivity and credentials."
              )
            }
            for (const i of dead) {
              if (!f.json) {
                console.error(
                  styleWarn(
                    `  Forward ${ids[i]} (${resolved[i].displayName}:${resolved[i].remotePort}) failed to start`
                  )
                )
              }
            }
          }
          process.exit(dead.length > 0 ? 1 : 0)
        }

        // Foreground mode: wait for children, clean up on exit
        const shutdown = () => {
          for (const child of children) {
            if (!child.killed) child.kill("SIGTERM")
          }
          for (const id of ids) {
            state.remove(id)
          }
        }
        process.on("SIGINT", shutdown)
        process.on("SIGTERM", shutdown)

        await Promise.all(
          children.map(
            (child, i) =>
              new Promise<void>((resolve) => {
                child.on("close", (code) => {
                  state.remove(ids[i])
                  if (code !== 0 && code !== null && !f.json) {
                    console.error(
                      styleWarn(
                        `  Forward ${ids[i]} (${resolved[i].displayName}:${resolved[i].remotePort}) exited with code ${code}`
                      )
                    )
                  }
                  resolve()
                })
              })
          )
        )

        process.off("SIGINT", shutdown)
        process.off("SIGTERM", shutdown)

        if (!f.json) {
          console.log(styleMuted("\n  All forwards closed."))
        }
        process.exit(0)
      })

      // ── dx forward list ──────────────────────────────────────────
      .command("list", (c) =>
        c
          .meta({ description: "List active port forwards" })
          .run(({ flags }) => {
            const f = toDxFlags(flags)
            const state = new ForwardState()
            const entries = state.list()

            if (f.json) {
              console.log(
                JSON.stringify({ success: true, data: entries }, null, 2)
              )
              return
            }

            if (entries.length === 0) {
              console.log("No active forwards.")
              return
            }

            console.log(
              printTable(
                ["ID", "Host", "Remote", "Local", "Status", "PID"],
                entries.map((e) => [
                  e.id,
                  e.displayName,
                  String(e.remotePort),
                  `localhost:${e.localPort}`,
                  colorStatus("active"),
                  String(e.pid),
                ])
              )
            )
          })
      )

      // ── dx forward close ─────────────────────────────────────────
      .command("close", (c) =>
        c
          .meta({ description: "Close port forwards" })
          .args([
            {
              name: "id",
              type: "string",
              description: "Forward ID to close",
            },
          ])
          .flags({
            all: { type: "boolean", description: "Close all active forwards" },
          })
          .run(({ args, flags }) => {
            const f = toDxFlags(flags)
            const state = new ForwardState()
            const id = args.id as string | undefined

            if (!id && !flags.all) {
              exitWithError(
                f,
                "Provide a forward ID or use --all.\n  Run 'dx forward list' to see active forwards."
              )
            }

            if (flags.all) {
              const entries = state.list()
              let killed = 0
              for (const entry of entries) {
                try {
                  process.kill(entry.pid, "SIGTERM")
                  killed++
                } catch {
                  // already dead
                }
              }
              state.clear()
              actionResult(
                flags,
                { closed: killed },
                styleSuccess(`Closed ${killed} forward(s).`)
              )
              return
            }

            // Close by ID
            const entries = state.list()
            const entry = entries.find((e) => e.id === id)
            if (!entry) {
              exitWithError(
                f,
                `Forward "${id}" not found. Run 'dx forward list' to see active forwards.`
              )
            }

            try {
              process.kill(entry.pid, "SIGTERM")
            } catch {
              // already dead
            }
            state.remove(entry.id)
            actionResult(
              flags,
              {
                closed: entry.id,
                host: entry.displayName,
                port: entry.remotePort,
              },
              styleSuccess(
                `Closed forward ${entry.id} (${entry.displayName}:${entry.remotePort})`
              )
            )
          })
      )
  )
}
