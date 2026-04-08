/**
 * Shared utility for IDE hook scripts — reads dx session token,
 * POSTs hook events to the Factory API fire-and-forget.
 *
 * Never throws. Never blocks longer than 2 seconds. Never crashes the IDE.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

const DEBUG = process.env.FACTORY_HOOK_DEBUG === "1"
const MAX_PAYLOAD_BYTES = 64 * 1024 // 64 KB

export type HookEvent = {
  source: "claude-code" | "cursor"
  deliveryId: string
  eventType: string
  action?: string
  sessionId: string
  timestamp: string
  cwd?: string
  project?: string
  payload?: Record<string, unknown>
}

function debug(...args: unknown[]) {
  if (DEBUG) console.error("[factory-hook]", ...args)
}

function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}

function getDxConfigDir(): string {
  const platform = process.platform
  if (platform === "darwin") return join(homedir(), "Library", "Preferences", "dx")
  if (platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "dx")
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "dx")
}

function getBearerToken(): string | null {
  const sessionFile = join(getDxConfigDir(), "session.json")
  const session = readJsonFile(sessionFile)
  const token = session?.bearerToken as string | undefined
  return token && token.length > 0 ? token : null
}

function getFactoryUrl(): string {
  if (process.env.FACTORY_API_URL) return process.env.FACTORY_API_URL
  if (process.env.DX_FACTORY_URL) return process.env.DX_FACTORY_URL

  const configFile = join(getDxConfigDir(), "config.json")
  const config = readJsonFile(configFile)
  const url = config?.factoryUrl as string | undefined

  if (url === "local") return "http://localhost:4100"
  return url && url.length > 0 ? url : "https://factory.lepton.software"
}

function truncatePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(payload)
  if (json.length <= MAX_PAYLOAD_BYTES) return payload

  return {
    _truncated: true,
    _originalSizeBytes: json.length,
    // Keep key fields, drop large values
    ...Object.fromEntries(
      Object.entries(payload).map(([k, v]) => {
        const valStr = JSON.stringify(v)
        if (valStr && valStr.length > 8192) {
          return [k, `[truncated: ${valStr.length} bytes]`]
        }
        return [k, v]
      }),
    ),
  }
}

export async function sendHookEvent(event: HookEvent): Promise<void> {
  try {
    const token = getBearerToken()
    if (!token) {
      debug("no dx session token found, skipping")
      return
    }

    const factoryUrl = getFactoryUrl()
    const url = `${factoryUrl}/api/v1/factory/ide-hooks/events`

    const body = {
      ...event,
      payload: event.payload ? truncatePayload(event.payload) : {},
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      debug(`POST ${url} → ${res.status}`)
    } finally {
      clearTimeout(timeout)
    }
  } catch (err) {
    debug("failed to send hook event:", err)
    // Silent failure — never crash the IDE
  }
}
