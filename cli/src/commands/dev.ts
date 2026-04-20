import type { DerivedOverride } from "@smp/factory-shared/compose-env-propagation"
import type { ResolvedConnectionContext } from "@smp/factory-shared/connection-context-schemas"
import { spawnSync } from "node:child_process"

import { styleMuted } from "../cli-style.js"
import type { DxBase } from "../dx-root.js"
import { exitWithError } from "../lib/cli-exit.js"
import {
  autoConnectsFromDeps,
  coveredSystemsFromConnectFlags,
} from "../lib/auto-connect.js"
import { SiteOrchestrator } from "../lib/site-orchestrator.js"
import { resolveDxContext } from "../lib/dx-context.js"
import { runPrelude } from "../lib/prelude.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { toDxFlags } from "./dx-flags.js"

setExamples("dev", [
  "$ dx dev                           Start all component dev servers",
  "$ dx dev factory-api               Start specific components",
  "$ dx dev --connect-to production   Start with production deps",
  "$ dx dev --profile production      Start with saved connection profile",
  "$ dx dev stop                      Stop all dev servers",
  "$ dx dev ps                        Show running dev servers",
])

export function devCommand(app: DxBase) {
  return app
    .sub("dev")
    .meta({ description: "Local development" })
    .args([
      {
        name: "components",
        type: "string",
        variadic: true,
        description: "Component names to start (all if omitted)",
      },
    ])
    .flags({
      "connect-to": {
        type: "string" as const,
        description: "Connect all deps to a deployment target",
      },
      connect: {
        type: "string" as const,
        short: "c",
        description: "Selective connection: dep:target (repeatable)",
      },
      profile: {
        type: "string" as const,
        short: "p",
        description: "Connection profile name",
      },
      env: {
        type: "string" as const,
        short: "e",
        description: "Env var override: KEY=VALUE (repeatable)",
      },
      "dry-run": {
        type: "boolean" as const,
        description: "Show what would happen without starting anything",
      },
      restart: {
        type: "boolean" as const,
        short: "r",
        description: "Restart dev server(s) without re-running setup or Docker",
      },
      build: {
        type: "boolean" as const,
        description:
          "Build Docker images (default: auto-detect, --no-build to skip)",
      },
      tunnel: {
        type: "boolean" as const,
        short: "t",
        description: "Expose dev ports via public tunnel URLs",
      },
      console: {
        type: "boolean" as const,
        description:
          "Start the local dev console web UI (default: true, use --no-console to disable)",
      },
      "expose-console": {
        type: "boolean" as const,
        description:
          "Publish the dev console through the tunnel (off by default; the console is unauthenticated)",
      },
      prelude: {
        type: "boolean" as const,
        description:
          "Run cached prelude before dev (default: true, use --no-prelude to skip)",
      },
      fresh: {
        type: "boolean" as const,
        description: "Invalidate prelude stamps and re-run every step",
      },
    })
    .run(async ({ args, flags }) => {
      const f = toDxFlags(flags)

      try {
        const ctx = await resolveDxContext({ need: "project" })
        const project = ctx.project
        const workingDir = project.rootDir

        // ── Check for running agent ─────────────────────────────
        const {
          getRunningAgent,
          spawnAgentDaemon,
          waitForHealthy,
          attachToAgent,
          stopAgent,
        } = await import("../site/agent-lifecycle.js")

        const existing = await getRunningAgent(workingDir)
        if (existing) {
          if (!f.quiet) {
            console.log(
              `Site agent already running (PID ${existing.pid}, port ${existing.port})`
            )
            console.log(`Attaching to log stream... (Ctrl+C to detach)`)
          }
          await attachToAgent(existing.port, { quiet: f.quiet })
          return
        }

        // ── Setup phase (runs in foreground — user sees output) ──

        // Auto-connect
        const userConnect = flags.connect as string | string[] | undefined
        const coveredSystems = coveredSystemsFromConnectFlags(userConnect)
        const auto = autoConnectsFromDeps({
          catalog: project.catalog,
          hasConnectToFlag: Boolean(flags["connect-to"]),
          coveredSystems,
        })
        if (auto.errors.length > 0) {
          for (const err of auto.errors) console.error(`  ! ${err}`)
          exitWithError(
            f,
            `cannot resolve ${auto.errors.length} required system ${auto.errors.length === 1 ? "dependency" : "dependencies"}`
          )
          return
        }
        if (!f.quiet) {
          for (const log of auto.logs) console.log(log)
          for (const warn of auto.warnings) console.warn(`  ! ${warn}`)
        }
        const userConnectList = !userConnect
          ? []
          : Array.isArray(userConnect)
            ? userConnect
            : [userConnect]
        const effectiveConnectSpecific = [
          ...userConnectList,
          ...auto.autoConnects,
        ]
        const connectFlagForSession =
          effectiveConnectSpecific.length > 0
            ? effectiveConnectSpecific
            : undefined

        // Cached prelude (interactive — must run in foreground)
        await runPrelude(ctx, {
          noPrelude: flags.prelude === false,
          fresh: Boolean(flags.fresh),
          connectTo: flags["connect-to"] as string | undefined,
          connectProfile: flags.profile as string | undefined,
          connectSpecific: connectFlagForSession,
          quiet: Boolean(f.quiet),
        })

        // Pre-flight: run codegen (interactive — must run in foreground)
        const codegen = ctx.package?.toolchain.codegen ?? []
        if (codegen.length > 0 && !f.quiet) {
          if (flags["dry-run"]) {
            console.log(
              `  [dry-run] Would run ${codegen.length} code generator(s): ${codegen.map((g) => g.runCmd).join(", ")}`
            )
          } else {
            console.log(`  Running ${codegen.length} code generator(s)...`)
            for (const gen of codegen) {
              const [bin, ...genArgs] = gen.runCmd.split(" ")
              spawnSync(bin!, genArgs, {
                cwd: project.rootDir,
                stdio: "inherit",
                shell: true,
              })
            }
          }
        }

        if (flags["dry-run"]) {
          console.log("[dry-run] Would start site agent daemon")
          return
        }

        // ── Spawn daemon ────────────────────────────────────────
        const port = 4299 // same port the console used to use
        if (!f.quiet) {
          console.log(`  Starting site agent daemon...`)
        }

        spawnAgentDaemon({
          mode: "dev",
          workingDir,
          port,
          components: args.components,
          connectTo: flags["connect-to"] as string | undefined,
          connect: connectFlagForSession,
          profile: flags.profile as string | undefined,
          env: flags.env as string[] | undefined,
          noBuild: flags.build === false,
          tunnel: !!flags.tunnel,
          exposeConsole: !!flags["expose-console"],
        })

        // ── Wait for health ─────────────────────────────────────
        const healthy = await waitForHealthy(port, 60_000)
        if (!healthy) {
          const { agentLogPath } = await import("../site/agent-lifecycle.js")
          const logPath = agentLogPath(workingDir)
          exitWithError(
            f,
            `Site agent did not become healthy within 60s. Check logs: ${logPath}`
          )
          return
        }

        if (!f.quiet) {
          console.log(`  Site agent running (port ${port})`)
          console.log(`  Dev Console: http://localhost:${port}`)
          console.log(
            `${styleMuted("Attaching to agent logs. Press Ctrl+C to detach.")}`
          )
        }

        // ── Attach to log stream ────────────────────────────────
        await attachToAgent(port, { quiet: f.quiet })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        exitWithError(f, msg)
      }
    })
    .command("start", (c) =>
      c
        .meta({ description: "Start a native dev server for a component" })
        .args([
          {
            name: "component",
            type: "string" as const,
            description: "Component name to start",
          },
        ])
        .flags({
          port: {
            type: "number" as const,
            description: "Override the port",
          },
        })
        .run(async ({ args, flags }) => {
          try {
            const orch = await SiteOrchestrator.create()
            const component = args.component
            if (!component) {
              console.error("Usage: dx dev start <component>")
              process.exit(1)
            }

            const result = await orch.startComponent(component, {
              port: flags.port as number | undefined,
            })

            if (result.alreadyRunning) {
              console.log(
                `${result.name} already running on :${result.port} (PID ${result.pid})`
              )
            } else {
              if (result.stoppedDocker) {
                console.log(`Stopped Docker container for ${result.name}`)
              }
              console.log(
                `Started ${result.name} on :${result.port} (PID ${result.pid})`
              )
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            console.error(`Error: ${msg}`)
            process.exit(1)
          }
        })
    )
    .command("stop", (c) =>
      c
        .meta({ description: "Stop the site agent and all dev servers" })
        .args([
          {
            name: "component",
            type: "string" as const,
            description: "Component name (stops agent if omitted)",
          },
        ])
        .run(async ({ args }) => {
          try {
            if (args.component) {
              // Stop a single component via the agent API
              const { getRunningAgent } =
                await import("../site/agent-lifecycle.js")
              const ctx = await resolveDxContext({ need: "project" })
              const state = await getRunningAgent(ctx.project.rootDir)
              if (!state) {
                console.log("No site agent running.")
                return
              }
              const res = await fetch(
                `http://localhost:${state.port}/api/v1/site/services/${args.component}/stop`,
                { method: "POST" }
              )
              if (!res.ok) {
                console.error(`Failed to stop ${args.component}`)
              } else {
                console.log(`Stopped ${args.component}`)
              }
              return
            }

            // Stop the entire agent
            const ctx = await resolveDxContext({ need: "project" })
            const { stopAgent } = await import("../site/agent-lifecycle.js")
            const stopped = await stopAgent(ctx.project.rootDir)
            if (stopped) {
              console.log("Site agent stopped.")
            } else {
              console.log("No site agent running.")
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            console.error(`Error: ${msg}`)
            process.exit(1)
          }
        })
    )
    .command("restart", (c) =>
      c
        .meta({ description: "Restart a native dev server" })
        .args([
          {
            name: "component",
            type: "string" as const,
            required: true,
            description: "Component name to restart",
          },
        ])
        .run(async ({ args }) => {
          try {
            const orch = await SiteOrchestrator.create()
            const result = await orch.restartComponent(args.component)
            console.log(
              `Restarted ${result.name} on :${result.port} (PID ${result.pid})`
            )
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            console.error(`Error: ${msg}`)
            process.exit(1)
          }
        })
    )
    .command("ps", (c) =>
      c.meta({ description: "List running dev servers" }).run(async () => {
        try {
          const orch = await SiteOrchestrator.create()
          const services = await orch.getUnifiedServices()

          if (services.length === 0) {
            console.log("No dev servers tracked.")
            return
          }

          for (const s of services) {
            const pid = s.pid ? `PID ${s.pid}` : ""
            const ports = s.ports || ""
            console.log(
              `  ${s.name.padEnd(20)} ${s.runtime.padEnd(10)} ${ports.padEnd(7)} ${pid.padEnd(12)} ${s.status}`
            )
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`Error: ${msg}`)
          process.exit(1)
        }
      })
    )
    .command("logs", (c) =>
      c
        .meta({ description: "Show dev server logs" })
        .args([
          {
            name: "component",
            type: "string" as const,
            required: true,
            description: "Component name",
          },
        ])
        .flags({
          follow: {
            type: "boolean" as const,
            short: "f",
            description: "Follow the log output",
          },
        })
        .run(async ({ args, flags }) => {
          try {
            const orch = await SiteOrchestrator.create()

            if (flags.follow) {
              const { join } = await import("node:path")
              const logPath = join(
                orch.project.rootDir,
                ".dx",
                "dev",
                `${args.component}.log`
              )
              const { existsSync } = await import("node:fs")
              if (!existsSync(logPath)) {
                console.error(`No log file found for ${args.component}`)
                process.exit(1)
              }
              spawnSync("tail", ["-f", logPath], { stdio: "inherit" })
            } else {
              const content = await orch.logs(args.component)
              console.log(content)
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            console.error(`Error: ${msg}`)
            process.exit(1)
          }
        })
    )
}

// ── Helpers ──────────────────────────────────────────────────────────

function printConnectionBanner(
  ctx: ResolvedConnectionContext,
  target: string,
  derivedOverrides: DerivedOverride[],
  stoppedServices: string[]
): void {
  const label = target.toUpperCase()
  const lines: string[] = []

  lines.push(`  \u26A0  CONNECTING TO ${label}`)
  lines.push("")

  if (stoppedServices.length > 0) {
    lines.push("  Stopped (remote) containers:")
    for (const dep of stoppedServices) {
      lines.push(`    ${dep} \u2192 ${target}`)
    }
    lines.push("")
  }

  const reconfigured = derivedOverrides.filter(
    (d) => Object.keys(d.overrides).length > 0
  )
  if (reconfigured.length > 0) {
    lines.push("  Reconfigured Docker services:")
    for (const d of reconfigured) {
      const vars = Object.keys(d.overrides).join(", ")
      lines.push(`    ${d.service} \u2192 ${vars}`)
    }
    lines.push("")
  }

  if (ctx.localDeps.length > 0) {
    lines.push("  Local dependencies:")
    for (const dep of ctx.localDeps) {
      lines.push(`    ${dep} \u2192 local Docker container`)
    }
    lines.push("")
  }

  const connectionVars = Object.entries(ctx.envVars).filter(
    ([, v]) => v.source === "connection" || v.source === "tier"
  )
  if (connectionVars.length > 0) {
    lines.push("  Resolved env vars:")
    for (const [key, entry] of connectionVars) {
      const display = entry.value.replace(/\/\/([^:]+):([^@]+)@/, "//$1:***@")
      lines.push(`    ${key}=${display}`)
    }
    lines.push("")
  }

  const maxLen = Math.max(...lines.map((l) => l.length), 60)
  const border = "\u2550".repeat(maxLen + 2)

  console.log("")
  console.log(`  \u2554${border}\u2557`)
  for (const line of lines) {
    console.log(`  \u2551 ${line.padEnd(maxLen)} \u2551`)
  }
  console.log(`  \u255A${border}\u255D`)
  console.log("")
}
