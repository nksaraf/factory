/**
 * Daemon process management — start, stop, health-check the local factory.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

import { DxError } from "../lib/dx-error.js"
import { DX_CONFIG_DIR } from "../lib/host-dirs.js"
import { log } from "../lib/logger.js"
import { capture } from "../lib/subprocess.js"
import { ensureLocalCluster } from "./ensure-cluster.js"

const PID_FILE = join(DX_CONFIG_DIR, "daemon.pid")
const LOG_FILE = join(DX_CONFIG_DIR, "daemon.log")
const HEALTH_URL = "http://localhost:4100/health"
const HEALTH_TIMEOUT_MS = 30_000
const HEALTH_POLL_MS = 300

function readPid(): number | null {
  try {
    const raw = readFileSync(PID_FILE, "utf-8").trim()
    const pid = parseInt(raw, 10)
    return Number.isFinite(pid) ? pid : null
  } catch {
    return null
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0) // signal 0 = existence check
    return true
  } catch {
    return false
  }
}

/**
 * Check whether the local factory daemon is running and healthy.
 */
export async function isLocalDaemonRunning(): Promise<boolean> {
  const pid = readPid()
  if (!pid || !isProcessAlive(pid)) return false

  // Process exists — verify it responds to health
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Start the local factory daemon as a detached background process.
 * @param kubeconfigPath - path to the k3d kubeconfig (from ensureLocalCluster)
 */
export async function startLocalDaemon(kubeconfigPath?: string): Promise<void> {
  // Resolve the server entry point relative to this file
  const serverEntry = resolve(__dirname, "server.ts")
  const { mkdirSync, openSync, closeSync } = await import("node:fs")
  mkdirSync(DX_CONFIG_DIR, { recursive: true })

  // Spawn bun with the server entry point as a detached background process.
  // Requires bun + source files + node_modules on disk (the compiled CLI binary
  // can't embed the full API server due to transitive dependency issues).
  const { spawn } = await import("node:child_process")
  const logFd = openSync(LOG_FILE, "a")
  const proc = spawn("bun", ["--bun", serverEntry, "--full"], {
    stdio: ["ignore", logFd, logFd],
    detached: true,
    env: {
      ...process.env,
      DX_GATEWAY_DOMAIN: process.env.DX_GATEWAY_DOMAIN ?? "localhost",
      SANDBOX_STORAGE_CLASS: process.env.SANDBOX_STORAGE_CLASS ?? "local-path",
      // Pass migrations dir explicitly so it works regardless of __dirname resolution
      FACTORY_MIGRATIONS_DIR:
        process.env.FACTORY_MIGRATIONS_DIR ??
        resolve(process.cwd(), "api/drizzle"),
      ...(kubeconfigPath ? { KUBECONFIG: kubeconfigPath } : {}),
    },
  })
  proc.unref()
  closeSync(logFd)
}

/**
 * Stop the local factory daemon by sending SIGTERM.
 */
export async function stopLocalDaemon(): Promise<void> {
  const pid = readPid()
  if (!pid) return

  if (isProcessAlive(pid)) {
    process.kill(pid, "SIGTERM")
  }

  try {
    unlinkSync(PID_FILE)
  } catch {}
}

/**
 * Ensure the local factory daemon is running. Starts it if needed and
 * waits for the health endpoint to respond.
 *
 * Also ensures the k3d cluster is healthy before starting the daemon,
 * so workbench provisioning works out of the box.
 */
export async function ensureLocalDaemon(): Promise<void> {
  if (await isLocalDaemonRunning()) return

  // Ensure k3d cluster is healthy before starting daemon
  log.debug("Ensuring local k3d cluster is ready...")
  let kubeconfigPath: string | undefined
  try {
    kubeconfigPath = await ensureLocalCluster()
    log.debug(`Cluster ready, kubeconfig: ${kubeconfigPath}`)
  } catch (err) {
    // Wrap if not already a DxError
    if (err instanceof DxError) throw err
    throw DxError.wrap(err, {
      operation: "ensure local cluster for daemon",
      code: "CLUSTER_SETUP_FAILED",
      suggestions: [
        { action: "docker info", description: "Check if Docker is running" },
        {
          action: "dx doctor --category local",
          description: "Run local diagnostics",
        },
      ],
    })
  }

  // Clean up stale PID
  const stalePid = readPid()
  if (stalePid && !isProcessAlive(stalePid)) {
    try {
      unlinkSync(PID_FILE)
    } catch {}
  }

  await startLocalDaemon(kubeconfigPath)

  // Poll health endpoint
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1000) })
      if (res.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS))
  }

  throw new DxError(
    `Local factory daemon did not become healthy within ${HEALTH_TIMEOUT_MS / 1000}s.`,
    {
      operation: "start local daemon",
      code: "DAEMON_HEALTH_TIMEOUT",
      metadata: { logFile: LOG_FILE, healthUrl: HEALTH_URL },
      suggestions: [
        {
          action: `cat ${LOG_FILE}`,
          description: "Check daemon logs for errors",
        },
        {
          action: "dx doctor --category local",
          description: "Run local diagnostics",
        },
      ],
    }
  )
}
