import {
  type DerivedOverride,
  buildConnectionEndpoints,
  deriveServiceEnvOverrides,
  expandRemoteDeps,
} from "@smp/factory-shared/compose-env-propagation"
import type {
  NormalizedProfileEntry,
  ResolvedConnectionContext,
} from "@smp/factory-shared/connection-context-schemas"
import { normalizeProfileEntry } from "@smp/factory-shared/connection-context-schemas"
import { loadConnectionProfile } from "@smp/factory-shared/connection-profile-loader"
import { isDevComponent } from "@smp/factory-shared"
import { DependencyGraph } from "@smp/factory-shared/dependency-graph"
import { resolveEnvVars } from "@smp/factory-shared/env-resolution"
import { spawnSync } from "node:child_process"
import { existsSync, unlinkSync, writeFileSync } from "node:fs"
import { createConnection } from "node:net"
import { basename, join } from "node:path"

import { styleMuted } from "../cli-style.js"
import type { DxBase } from "../dx-root.js"
import { exitWithError } from "../lib/cli-exit.js"
import {
  COMPOSE_OVERRIDE_FILE,
  cleanupConnectionContext,
  readConnectionContext,
  writeConnectionContext,
} from "../lib/connection-context-file.js"
import { DevController } from "../lib/dev-controller.js"
import { Compose, isDockerRunning } from "../lib/docker.js"
import { type ProjectContextData, resolveDxContext } from "../lib/dx-context.js"
import { hooksHealthy, installHooks } from "../lib/hooks.js"
import {
  mergeConnectionSources,
  parseConnectFlags,
  parseConnectToFlag,
  parseEnvFlags,
} from "../lib/parse-connect-flags.js"
import {
  PortManager,
  catalogToPortRequests,
  portEnvVars,
} from "../lib/port-manager.js"
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

function makeController(project: ProjectContextData): DevController {
  return new DevController(
    project.rootDir,
    project.catalog,
    project.composeFiles
  )
}

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
    })
    .run(async ({ args, flags }) => {
      const f = toDxFlags(flags)
      const dryRun = !!flags["dry-run"]
      const doRestart = !!flags["restart"]

      try {
        const ctx = await resolveDxContext({ need: "project" })
        const project = ctx.project

        // Pre-flight: ensure hooks are healthy
        if (!hooksHealthy(project.rootDir)) {
          if (!f.quiet) console.log("  Syncing git hooks...")
          installHooks(project.rootDir)
        }

        // Pre-flight: run codegen if generators are detected
        const codegen = ctx.package?.toolchain.codegen ?? []
        if (codegen.length > 0 && !f.quiet) {
          if (dryRun) {
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

        const ctrl = makeController(project)

        // ── --restart: skip setup, reuse saved connection context ────
        if (doRestart) {
          const devableComponents = Object.entries(project.catalog.components)
            .filter(([_, comp]) => isDevComponent(comp))
            .map(([name]) => name)
          const targets = args.components?.length
            ? args.components
            : devableComponents

          if (targets.length === 0) {
            console.log("No dev-able components found.")
            return
          }

          const savedCtx = readConnectionContext(project.rootDir)
          const env = savedCtx
            ? Object.fromEntries(
                Object.entries(savedCtx.envVars).map(([k, v]) => [k, v.value])
              )
            : undefined

          for (const component of targets) {
            try {
              ctrl.stop(component)
              const result = await ctrl.start(component, {
                env: env && Object.keys(env).length > 0 ? env : undefined,
              })
              console.log(
                `Restarted ${result.name} on :${result.port} (PID ${result.pid})`
              )
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              console.error(`Error restarting ${component}: ${msg}`)
            }
          }
          return
        }

        // Resolve all ports (for both dev servers and infra) and write ports.env
        const portManager = new PortManager(join(project.rootDir, ".dx"))
        const portRequests = catalogToPortRequests(project.catalog)
        const resolved = await portManager.resolveMulti(portRequests)

        const allEnvVars: Record<string, string> = {}
        for (const [service, ports] of Object.entries(resolved)) {
          Object.assign(allEnvVars, portEnvVars(service, ports))
        }
        const envPath = join(project.rootDir, ".dx", "ports.env")
        if (!dryRun) portManager.writeEnvFile(allEnvVars, envPath)

        // ── Shared infrastructure ──────────────────────────────────
        const graph = DependencyGraph.fromCatalog(project.catalog)
        const hasConnectionFlags =
          flags["connect-to"] || flags.connect || flags.profile

        // Create compose instance once (reused for remote deps, local deps, overrides)
        const compose =
          project.composeFiles.length > 0
            ? new Compose(
                project.composeFiles,
                basename(project.rootDir),
                envPath
              )
            : null

        // ── Active restore: clean up stale connection state ─────────
        if (!hasConnectionFlags && !dryRun) {
          restoreLocalState(project, envPath, !!f.quiet)
        }

        // ── Connection resolution ────────────────────────────────────
        let connectionCtx: ResolvedConnectionContext | null = null
        let connectionEnv: Record<string, string> = {}
        let profileName: string | undefined
        let allRemoteDeps: string[] = []

        if (hasConnectionFlags) {
          profileName =
            (flags["connect-to"] as string | undefined) ??
            (flags.profile as string | undefined)

          const profile = profileName
            ? loadConnectionProfile(project.rootDir, profileName)
            : null

          const profileEnv = profile?.env ?? {}

          let profileOverrides:
            | Record<string, NormalizedProfileEntry>
            | undefined
          if (profile && Object.keys(profile.connect).length > 0) {
            profileOverrides = {}
            for (const [key, entry] of Object.entries(profile.connect)) {
              profileOverrides[key] = normalizeProfileEntry(entry)
            }
          }

          const connectToOverrides = flags["connect-to"]
            ? parseConnectToFlag(flags["connect-to"] as string, project.catalog)
            : undefined

          const connectFlags = flags.connect
            ? parseConnectFlags(
                Array.isArray(flags.connect)
                  ? flags.connect
                  : [flags.connect as string]
              )
            : undefined

          const overrides = mergeConnectionSources(
            profileOverrides,
            connectToOverrides,
            connectFlags
          )

          const envFlags = flags.env
            ? parseEnvFlags(
                Array.isArray(flags.env) ? flags.env : [flags.env as string]
              )
            : undefined

          const tierOverlay =
            Object.keys(profileEnv).length > 0 ? profileEnv : undefined

          connectionCtx = resolveEnvVars({
            catalog: project.catalog,
            tierOverlay,
            connectionOverrides: overrides,
            cliEnvFlags: envFlags,
          })

          connectionEnv = Object.fromEntries(
            Object.entries(connectionCtx.envVars).map(([k, v]) => [k, v.value])
          )

          // Graph-based connection propagation
          const endpoints = buildConnectionEndpoints(
            overrides ?? {},
            project.catalog
          )
          const explicitDeps = Object.keys(overrides ?? {}).filter((name) =>
            endpoints.has(name)
          )

          allRemoteDeps = expandRemoteDeps(
            explicitDeps,
            graph,
            endpoints,
            profileName ?? "remote"
          )

          const derivedOverrides = deriveServiceEnvOverrides(
            project.catalog,
            graph,
            allRemoteDeps,
            endpoints
          )

          // Stop remote deps' containers to free ports
          if (allRemoteDeps.length > 0 && compose) {
            if (dryRun) {
              console.log(
                `  [dry-run] Would stop remote dep containers: ${allRemoteDeps.join(", ")}`
              )
            } else {
              if (!f.quiet) {
                console.log(
                  `  Stopping remote dep containers: ${allRemoteDeps.join(", ")}`
                )
              }
              compose.stop(allRemoteDeps)
            }
          }

          // Write compose override and restart reconfigured services
          const reconfiguredServices: string[] = []
          if (derivedOverrides.length > 0) {
            const overridesWithEnv = derivedOverrides.filter(
              (d) => Object.keys(d.overrides).length > 0
            )
            reconfiguredServices.push(...overridesWithEnv.map((d) => d.service))

            if (overridesWithEnv.length > 0) {
              if (dryRun) {
                console.log(
                  `  [dry-run] Would restart reconfigured Docker services with env overrides: ${reconfiguredServices.join(", ")}`
                )
              } else {
                writeComposeOverride(project.rootDir, overridesWithEnv)

                const overridePath = join(
                  project.rootDir,
                  ".dx",
                  COMPOSE_OVERRIDE_FILE
                )
                const overrideCompose = new Compose(
                  [...project.composeFiles, overridePath],
                  basename(project.rootDir),
                  envPath
                )
                overrideCompose.up({
                  detach: true,
                  noBuild: true,
                  noDeps: allRemoteDeps.length > 0,
                  services: reconfiguredServices,
                })
              }
            }

            for (const d of derivedOverrides) {
              for (const w of d.warnings) {
                console.log(`  \u26A0 ${w}`)
              }
            }
          }

          if (!dryRun) {
            writeConnectionContext(project.rootDir, connectionCtx, {
              stoppedServices: allRemoteDeps,
              reconfiguredServices,
            })
          }

          printConnectionBanner(
            connectionCtx,
            profileName ?? "remote",
            derivedOverrides,
            allRemoteDeps
          )

          if (connectionCtx.remoteDeps.length > 0) {
            await checkRemoteHealth(connectionCtx, !!f.quiet)
          }
        }

        // ── Determine dev targets ────────────────────────────────────

        const devableComponents = Object.entries(project.catalog.components)
          .filter(([_, comp]) => isDevComponent(comp))
          .map(([name]) => name)

        const targets = args.components?.length
          ? args.components
          : devableComponents

        if (targets.length === 0) {
          console.log(
            "No dev-able components found. Add dx.dev.command labels to your docker-compose services."
          )
          return
        }

        // ── Start local Docker dependencies ──────────────────────────
        const devTargetSet = new Set(targets)
        const remoteDepSet = new Set(allRemoteDeps)

        const allNeeded = new Set<string>()
        for (const target of targets) {
          for (const dep of graph.transitiveDeps(target)) {
            allNeeded.add(dep)
          }
        }

        const localDockerDeps = [...allNeeded].filter(
          (name) => !devTargetSet.has(name) && !remoteDepSet.has(name)
        )

        if (dryRun) {
          // ── Dry-run plan ─────────────────────────────────────────
          console.log("\nPlan:")
          if (localDockerDeps.length > 0) {
            const noDepsSuffix = remoteDepSet.size > 0 ? " (--no-deps)" : ""
            console.log(
              `  Docker (compose up -d${noDepsSuffix}): ${localDockerDeps.join(", ")}`
            )
          } else {
            console.log("  Docker: nothing to start")
          }
          for (const component of targets) {
            const comp = project.catalog.components[component]
            const cmd = comp?.spec.dev?.command ?? "(no dev command)"
            const port = resolved[component]?.[0]
            const portStr = port ? `:${port}` : ""
            console.log(`  Dev server: ${component}${portStr}  →  ${cmd}`)
          }
          if (allRemoteDeps.length > 0) {
            console.log(`  Remote deps: ${allRemoteDeps.join(", ")}`)
          }
          return
        }

        if (localDockerDeps.length > 0 && compose) {
          if (!isDockerRunning()) {
            exitWithError(
              f,
              "Docker is not running. Start Docker for infrastructure dependencies."
            )
          }
          if (!f.quiet) {
            console.log(`  Starting Docker deps: ${localDockerDeps.join(", ")}`)
          }
          // Use --no-deps when remote deps exist: we computed the full dep set
          // ourselves, so Docker Compose must not pull in depends_on services
          // (which may include the remote deps we just stopped).
          compose.up({
            detach: true,
            services: localDockerDeps,
            noDeps: remoteDepSet.size > 0,
          })
        }

        // ── Start dev servers ────────────────────────────────────────

        for (const component of targets) {
          try {
            const result = await ctrl.start(component, {
              env:
                Object.keys(connectionEnv).length > 0
                  ? connectionEnv
                  : undefined,
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
            console.error(`Error starting ${component}: ${msg}`)
          }
        }

        if (!f.quiet) {
          console.log(`\nUse ${styleMuted("dx ps")} to see all services.`)
        }
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
            const ctx = await resolveDxContext({ need: "project" })
            const ctrl = makeController(ctx.project)

            const component = args.component
            if (!component) {
              console.error("Usage: dx dev start <component>")
              process.exit(1)
            }

            const result = await ctrl.start(component, {
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
        .meta({ description: "Stop native dev server(s)" })
        .args([
          {
            name: "component",
            type: "string" as const,
            description: "Component name (stops all if omitted)",
          },
        ])
        .run(async ({ args }) => {
          try {
            const ctx = await resolveDxContext({ need: "project" })
            const ctrl = makeController(ctx.project)

            const stopped = ctrl.stop(args.component || undefined)
            if (stopped.length === 0) {
              console.log("No dev servers running.")
            } else {
              for (const s of stopped) {
                console.log(`Stopped ${s.name} (PID ${s.pid})`)
              }
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
            const ctx = await resolveDxContext({ need: "project" })
            const ctrl = makeController(ctx.project)

            const result = await ctrl.restart(args.component)
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
          const ctx = await resolveDxContext({ need: "project" })
          const ctrl = makeController(ctx.project)

          const servers = ctrl.ps()
          if (servers.length === 0) {
            console.log("No dev servers tracked.")
            return
          }
          for (const s of servers) {
            const status = s.running ? "running" : "stopped"
            console.log(
              `  ${s.name.padEnd(20)} :${String(s.port ?? "?").padEnd(6)} PID ${String(s.pid ?? "-").padEnd(8)} ${status}`
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
            const ctx = await resolveDxContext({ need: "project" })
            const ctrl = makeController(ctx.project)

            const logPath = ctrl.logs(args.component)
            if (flags.follow) {
              spawnSync("tail", ["-f", logPath], { stdio: "inherit" })
            } else {
              console.log(logPath)
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

  // Key env vars that were overridden
  const connectionVars = Object.entries(ctx.envVars).filter(
    ([, v]) => v.source === "connection" || v.source === "tier"
  )
  if (connectionVars.length > 0) {
    lines.push("  Resolved env vars:")
    for (const [key, entry] of connectionVars) {
      // Mask passwords in connection strings
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

/** TCP health check — resolve host:port from connection strings in env. */
async function checkRemoteHealth(
  ctx: ResolvedConnectionContext,
  quiet: boolean
): Promise<void> {
  // Extract unique host:port pairs from connection-sourced env vars
  const targets: { label: string; host: string; port: number }[] = []

  for (const [key, entry] of Object.entries(ctx.envVars)) {
    if (entry.source !== "connection" && entry.source !== "tier") continue

    // Parse postgresql://...@host:port/... or http://host:port/...
    const pgMatch = entry.value.match(/@([^:/]+):(\d+)/)
    const httpMatch = entry.value.match(/\/\/([^:/]+):(\d+)/)
    const match = pgMatch ?? httpMatch
    if (!match) continue

    const host = match[1]!
    const port = parseInt(match[2]!, 10)
    const already = targets.some((t) => t.host === host && t.port === port)
    if (!already) {
      targets.push({ label: key, host, port })
    }
  }

  if (targets.length === 0) return
  if (!quiet) console.log("  Checking remote connectivity...")

  for (const { label, host, port } of targets) {
    const ok = await tcpCheck(host, port, 3000)
    if (!quiet) {
      const status = ok ? "\u2713" : "\u2717 unreachable"
      console.log(`    ${host}:${port} (${label}) ${status}`)
    }
    if (!ok) {
      console.error(
        `\n  Error: Cannot reach ${host}:${port} (${label}).` +
          `\n  Check that the remote service is running and your network can reach it.\n`
      )
      process.exit(1)
    }
  }
  if (!quiet) console.log("")
}

function tcpCheck(
  host: string,
  port: number,
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: timeoutMs })
    socket.on("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.on("error", () => {
      socket.destroy()
      resolve(false)
    })
    socket.on("timeout", () => {
      socket.destroy()
      resolve(false)
    })
  })
}

/** Write a docker-compose override file from derived env overrides. */
function writeComposeOverride(
  rootDir: string,
  derivedOverrides: DerivedOverride[]
): void {
  const overridePath = join(rootDir, ".dx", COMPOSE_OVERRIDE_FILE)
  const lines: string[] = ["services:"]
  for (const d of derivedOverrides) {
    if (Object.keys(d.overrides).length === 0) continue
    lines.push(`  ${d.service}:`)
    lines.push(`    environment:`)
    for (const [key, val] of Object.entries(d.overrides)) {
      // Escape quotes and use double-quoted YAML strings for safety
      const escaped = val.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
      lines.push(`      ${key}: "${escaped}"`)
    }
  }
  writeFileSync(overridePath, lines.join("\n") + "\n")
}

/**
 * Active restore: detect stale connection context from a previous --connect-to
 * session. Restart stopped + reconfigured services with local config, then
 * clean up the override file and context.
 */
function restoreLocalState(
  project: ProjectContextData,
  envPath: string,
  quiet: boolean
): void {
  const prevCtx = readConnectionContext(project.rootDir)
  if (!prevCtx) return

  const stopped = prevCtx.stoppedServices ?? []
  const reconfigured = prevCtx.reconfiguredServices ?? []
  if (stopped.length === 0 && reconfigured.length === 0) {
    // Old-style context without tracking — just clean up
    cleanupConnectionContext(project.rootDir)
    return
  }

  if (!quiet) {
    console.log("  Restoring local state from previous connection session...")
  }

  // Remove the override file first so compose uses local config
  const overridePath = join(project.rootDir, ".dx", COMPOSE_OVERRIDE_FILE)
  if (existsSync(overridePath)) {
    unlinkSync(overridePath)
  }

  // Restart all affected services (stopped + reconfigured) with local config
  const allAffected = [...new Set([...stopped, ...reconfigured])]
  if (allAffected.length > 0) {
    const compose = new Compose(
      project.composeFiles,
      basename(project.rootDir),
      envPath
    )
    compose.up({
      detach: true,
      noBuild: true,
      services: allAffected,
    })

    if (!quiet) {
      console.log(
        `  Restored ${allAffected.length} service(s) to local config: ${allAffected.join(", ")}`
      )
    }
  }

  cleanupConnectionContext(project.rootDir)
}
