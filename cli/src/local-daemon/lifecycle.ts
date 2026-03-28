/**
 * Daemon process management — start, stop, health-check the local factory.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

import { capture } from "../lib/subprocess.js"

const PID_FILE = join(homedir(), ".config", "dx", "daemon.pid")
const LOG_FILE = join(homedir(), ".config", "dx", "daemon.log")
const HEALTH_URL = "http://localhost:4100/health"
const HEALTH_TIMEOUT_MS = 10_000
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
 */
export async function startLocalDaemon(): Promise<void> {
  // Resolve the server entry point relative to this file
  const serverEntry = resolve(__dirname, "server.ts")
  const { mkdirSync } = await import("node:fs")
  mkdirSync(join(homedir(), ".config", "dx"), { recursive: true })

  // Use node:child_process for reliable detached spawning
  const { spawn } = await import("node:child_process")
  const { openSync } = await import("node:fs")
  const logFd = openSync(LOG_FILE, "a")
  const proc = spawn("bun", ["--bun", serverEntry], {
    stdio: ["ignore", logFd, logFd],
    detached: true,
    env: { ...process.env },
  })
  proc.unref()
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
 */
export async function ensureLocalDaemon(): Promise<void> {
  if (await isLocalDaemonRunning()) return

  // Clean up stale PID
  const stalePid = readPid()
  if (stalePid && !isProcessAlive(stalePid)) {
    try { unlinkSync(PID_FILE) } catch {}
  }

  await startLocalDaemon()

  // Poll health endpoint
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1000) })
      if (res.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS))
  }

  throw new Error(
    `Local factory daemon did not become healthy within ${HEALTH_TIMEOUT_MS / 1000}s. ` +
    `Check logs at ${LOG_FILE}`
  )
}
