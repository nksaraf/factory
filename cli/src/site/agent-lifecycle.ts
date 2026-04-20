// cli/src/site/agent-lifecycle.ts
/**
 * Site agent daemon lifecycle — spawn, stop, health-check, attach.
 *
 * The agent is a detached background process. CLI commands spawn it
 * and attach to its log stream; Ctrl+C detaches without killing.
 *
 * State file: .dx/agent.json
 * Log file: .dx/agent.log
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { spawn as cpSpawn, type ChildProcess } from "node:child_process"

import {
  styleBold,
  styleMuted,
  styleInfo,
  styleSuccess,
  styleWarn,
  styleServiceStatus,
} from "../cli-style.js"
import type { AgentMode } from "./agent.js"

// ── Agent state file ────────────────────────────────────────────────

export interface AgentState {
  pid: number
  port: number
  mode: AgentMode
  startedAt: string
  workingDir: string
}

export function agentStatePath(workingDir: string): string {
  return join(workingDir, ".dx", "agent.json")
}

export function agentLogPath(workingDir: string): string {
  return join(workingDir, ".dx", "agent.log")
}

export function readAgentState(workingDir: string): AgentState | null {
  const path = agentStatePath(workingDir)
  try {
    const raw = readFileSync(path, "utf-8").trim()
    return JSON.parse(raw) as AgentState
  } catch {
    return null
  }
}

export function writeAgentState(workingDir: string, state: AgentState): void {
  const dir = join(workingDir, ".dx")
  mkdirSync(dir, { recursive: true })
  writeFileSync(agentStatePath(workingDir), JSON.stringify(state, null, 2))
}

export function clearAgentState(workingDir: string): void {
  try {
    unlinkSync(agentStatePath(workingDir))
  } catch {}
}

// ── Process management ──────────────────────────────────────────────

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Check whether a site agent is running and healthy.
 * Returns the agent state if healthy, null otherwise.
 */
export async function getRunningAgent(
  workingDir: string
): Promise<AgentState | null> {
  const state = readAgentState(workingDir)
  if (!state) return null

  // Check PID is alive
  if (!isProcessAlive(state.pid)) {
    clearAgentState(workingDir)
    return null
  }

  // Check health endpoint
  try {
    const res = await fetch(
      `http://localhost:${state.port}/api/v1/site/health`,
      { signal: AbortSignal.timeout(2000) }
    )
    if (res.ok) return state
  } catch {}

  // Process alive but not healthy — might be starting up
  return state
}

/**
 * Wait for the agent to become healthy (health endpoint responds OK).
 */
export async function waitForHealthy(
  port: number,
  timeoutMs = 30_000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  const healthUrl = `http://localhost:${port}/api/v1/site/health`

  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, {
        signal: AbortSignal.timeout(1000),
      })
      if (res.ok) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 300))
  }

  return false
}

// ── Spawn/Stop ──────────────────────────────────────────────────────

export interface SpawnAgentOpts {
  mode: AgentMode
  workingDir: string
  port: number

  // Session options (forwarded to the daemon)
  components?: string[]
  connectTo?: string
  connect?: string[]
  profile?: string
  env?: string[]
  noBuild?: boolean
  tunnel?: boolean
  exposeConsole?: boolean
  targets?: string[]
  profiles?: string[]
  detach?: boolean

  // Controller options
  siteName?: string
  standalone?: boolean
  airGapped?: boolean
  reconcileIntervalMs?: number
}

/**
 * Spawn the agent daemon as a detached background process.
 *
 * The daemon runs `dx __agent <mode>` with session config passed
 * as environment variables (avoiding CLI arg serialization issues).
 * Returns the expected port.
 */
export function spawnAgentDaemon(opts: SpawnAgentOpts): number {
  const dxDir = join(opts.workingDir, ".dx")
  mkdirSync(dxDir, { recursive: true })

  // Write session config to a file the daemon will read
  const configPath = join(dxDir, "agent-config.json")
  writeFileSync(configPath, JSON.stringify(opts, null, 2))

  // Resolve the dx binary — use process.argv[0] for compiled binary,
  // or the source entry point for development
  const dxBin = process.argv[0]!
  const isSourceMode = dxBin.endsWith("bun") || dxBin.includes("bun")

  const logFile = agentLogPath(opts.workingDir)
  const { openSync, closeSync } = require("node:fs") as typeof import("node:fs")
  const logFd = openSync(logFile, "a")

  let proc: ChildProcess
  if (isSourceMode) {
    // Running from source: bun run cli/src/site/agent-daemon.ts
    const daemonEntry = join(__dirname, "agent-daemon.ts")
    proc = cpSpawn("bun", ["--bun", daemonEntry, configPath], {
      stdio: ["ignore", logFd, logFd],
      detached: true,
      cwd: opts.workingDir,
      env: { ...process.env },
    })
  } else {
    // Running from compiled binary: dx __agent <config-path>
    proc = cpSpawn(dxBin, ["__agent", configPath], {
      stdio: ["ignore", logFd, logFd],
      detached: true,
      cwd: opts.workingDir,
      env: { ...process.env },
    })
  }

  proc.unref()
  closeSync(logFd)

  return opts.port
}

/**
 * Stop the running agent by sending SIGTERM.
 */
export async function stopAgent(workingDir: string): Promise<boolean> {
  const state = readAgentState(workingDir)
  if (!state) return false

  if (isProcessAlive(state.pid)) {
    process.kill(state.pid, "SIGTERM")
    // Wait briefly for process to exit
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100))
      if (!isProcessAlive(state.pid)) break
    }
  }

  clearAgentState(workingDir)
  return true
}

// ── Session banner ─────────────────────────────────────────────────

interface ServiceInfo {
  name: string
  mode: string
  status: string
  ports: Array<{
    name: string
    host: number
    container: number
    url: string
    tunnelUrl?: string
  }>
  pid?: number
  kind?: string | null
  type?: string | null
  deps?: string[]
}

interface StatusInfo {
  mode: string
  uptime: string
  project?: string
  tunnel?: { status: string; info?: { url: string } }
  site?: { slug: string }
  workbench?: { slug: string }
}

/**
 * Fetch agent status + services and print a concise session banner.
 * Shows what's running, in what mode, on what ports, and connections.
 * Silently falls back to nothing if the agent isn't ready yet.
 */
export async function printSessionBanner(port: number): Promise<void> {
  let status: StatusInfo
  let services: ServiceInfo[]

  try {
    const [statusRes, servicesRes] = await Promise.all([
      fetch(`http://localhost:${port}/api/v1/site/status`, {
        signal: AbortSignal.timeout(3000),
      }),
      fetch(`http://localhost:${port}/api/v1/site/services`, {
        signal: AbortSignal.timeout(3000),
      }),
    ])

    if (!statusRes.ok || !servicesRes.ok) return

    const statusBody = (await statusRes.json()) as { data: StatusInfo }
    const servicesBody = (await servicesRes.json()) as { data: ServiceInfo[] }
    status = statusBody.data
    services = servicesBody.data
  } catch {
    return // Agent not ready, skip banner
  }

  const PAD_NAME = 24
  const PAD_MODE = 10
  const PAD_PORT = 20

  // ── Header ──
  console.log("")
  const projectLabel = status.project ? styleInfo(status.project) : "unknown"
  const modeLabel =
    status.mode === "dev" ? styleSuccess("dev") : styleSuccess(status.mode)
  console.log(
    `  ${styleBold(projectLabel)} ${styleMuted("·")} mode: ${modeLabel} ${styleMuted("·")} uptime: ${styleMuted(status.uptime)}`
  )

  // ── Tunnel ──
  if (status.tunnel && status.tunnel.status !== "disconnected") {
    const tunnelStatus =
      status.tunnel.status === "connected"
        ? styleSuccess("connected")
        : styleWarn(status.tunnel.status)
    const tunnelUrl = status.tunnel.info?.url
      ? styleMuted(` ${status.tunnel.info.url}`)
      : ""
    console.log(`  ${styleMuted("tunnel:")} ${tunnelStatus}${tunnelUrl}`)
  }

  console.log("")

  if (services.length === 0) {
    console.log(`  ${styleMuted("No services running.")}`)
    console.log("")
    return
  }

  // ── Group services by mode ──
  const devServices = services.filter((s) => s.mode === "native")
  const containerServices = services.filter((s) => s.mode === "container")
  const remoteServices = services.filter(
    (s) => s.mode !== "native" && s.mode !== "container"
  )

  // ── Dev servers ──
  if (devServices.length > 0) {
    console.log(`  ${styleBold("Dev Servers")}`)
    for (const svc of devServices) {
      const statusStr = styleServiceStatus(svc.status)
      const portStr =
        svc.ports.length > 0
          ? styleInfo(svc.ports.map((p) => `:${p.host}`).join(", "))
          : styleMuted("no port")
      const pidStr = svc.pid ? styleMuted(`PID ${svc.pid}`) : ""
      console.log(
        `    ${styleInfo(svc.name.padEnd(PAD_NAME))} ${statusStr.padEnd(PAD_MODE)} ${portStr.padEnd(PAD_PORT)} ${pidStr}`
      )
    }
    console.log("")
  }

  // ── Containers (Docker deps) ──
  if (containerServices.length > 0) {
    console.log(`  ${styleBold("Docker Dependencies")}`)
    for (const svc of containerServices) {
      const statusStr = styleServiceStatus(svc.status)
      const portStr =
        svc.ports.length > 0
          ? styleMuted(svc.ports.map((p) => `:${p.host}`).join(", "))
          : styleMuted("—")
      const typeStr = svc.type ? styleMuted(`(${svc.type})`) : ""
      console.log(
        `    ${svc.name.padEnd(PAD_NAME)} ${statusStr.padEnd(PAD_MODE)} ${portStr.padEnd(PAD_PORT)} ${typeStr}`
      )
    }
    console.log("")
  }

  // ── Remote / linked ──
  if (remoteServices.length > 0) {
    console.log(`  ${styleBold("Remote")}`)
    for (const svc of remoteServices) {
      console.log(
        `    ${svc.name.padEnd(PAD_NAME)} ${styleMuted(`→ ${svc.mode}`)}`
      )
    }
    console.log("")
  }

  // ── Console URL ──
  console.log(`  ${styleMuted(`Dev Console: http://localhost:${port}`)}`)
  console.log("")
}

// ── Attach ──────────────────────────────────────────────────────────

/**
 * Attach to a running agent's log stream (SSE).
 * Returns when the connection closes (user presses Ctrl+C).
 */
export async function attachToAgent(
  port: number,
  opts?: { quiet?: boolean }
): Promise<void> {
  const url = `http://localhost:${port}/api/v1/site/agent/logs`

  return new Promise<void>((resolve) => {
    let aborted = false

    const controller = new AbortController()

    const detach = () => {
      if (aborted) return
      aborted = true
      controller.abort()
      if (!opts?.quiet) {
        console.log("\nDetached from site agent. Agent is still running.")
        console.log("  Re-attach: dx dev (or dx up --attach)")
        console.log("  Stop:      dx dev stop (or dx site stop)")
      }
      resolve()
    }

    process.on("SIGINT", detach)
    process.on("SIGTERM", detach)

    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          if (!opts?.quiet) {
            console.error(`Failed to attach: HTTP ${res.status}`)
          }
          resolve()
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ""

        while (!aborted) {
          const { value, done } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split("\n")
          buf = lines.pop() ?? ""
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const text = JSON.parse(line.slice(6))
                process.stdout.write(text + "\n")
              } catch {
                // Not JSON — print raw
                process.stdout.write(line.slice(6) + "\n")
              }
            }
          }
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError" && !opts?.quiet) {
          console.error(
            `Agent connection lost: ${err instanceof Error ? err.message : err}`
          )
        }
      })
      .finally(() => {
        process.removeListener("SIGINT", detach)
        process.removeListener("SIGTERM", detach)
        resolve()
      })
  })
}
