/**
 * Shared utility for IDE hook scripts — reads dx session token,
 * POSTs hook events to the Factory API fire-and-forget.
 *
 * Never throws. Never blocks longer than 4 seconds. Never crashes the IDE.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs"
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
  // @crustjs/store uses XDG convention on all platforms (including macOS)
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "dx")
}

function getSessionFile(): string {
  return join(getDxConfigDir(), "session.json")
}

function getSession(): { bearerToken?: string; jwt?: string } | null {
  const session = readJsonFile(getSessionFile())
  if (!session) return null
  return {
    bearerToken: session.bearerToken as string | undefined,
    jwt: session.jwt as string | undefined,
  }
}

/**
 * Check if a JWT is expired (with 60s buffer).
 */
function isJwtExpired(jwt: string): boolean {
  try {
    const parts = jwt.split(".")
    if (parts.length !== 3) return true
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")))
    const exp = payload.exp as number | undefined
    if (!exp) return true
    return Date.now() / 1000 > exp - 60
  } catch {
    return true
  }
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

function getAuthBasePath(): string {
  const configFile = join(getDxConfigDir(), "config.json")
  const config = readJsonFile(configFile)
  return (config?.authBasePath as string) || "/api/v1/auth"
}

/**
 * Refresh the JWT using the session bearer token.
 * Calls the Better Auth session endpoint which returns a fresh JWT.
 */
async function refreshJwt(factoryUrl: string, bearerToken: string): Promise<string | null> {
  try {
    const authBasePath = getAuthBasePath()
    const url = `${factoryUrl}${authBasePath}/get-session`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
        },
        signal: controller.signal,
      })

      if (!res.ok) {
        debug(`JWT refresh failed: ${res.status}`)
        return null
      }

      const data = await res.json() as Record<string, unknown>
      const newJwt = (data as any)?.session?.jwt as string | undefined
        ?? (data as any)?.jwt as string | undefined

      if (newJwt) {
        // Persist the refreshed JWT
        try {
          const sessionFile = getSessionFile()
          const session = readJsonFile(sessionFile) ?? {}
          session.jwt = newJwt
          writeFileSync(sessionFile, JSON.stringify(session, null, 2))
          debug("JWT refreshed and persisted")
        } catch {
          debug("JWT refreshed but failed to persist")
        }
        return newJwt
      }

      debug("JWT refresh response did not contain a JWT")
      return null
    } finally {
      clearTimeout(timeout)
    }
  } catch (err) {
    debug("JWT refresh error:", err)
    return null
  }
}

/**
 * Get a valid auth token. Prefers JWT, refreshes if expired, falls back to bearer token.
 */
async function getAuthToken(factoryUrl: string): Promise<string | null> {
  const session = getSession()
  if (!session) return null

  const { bearerToken, jwt } = session
  if (!bearerToken && !jwt) return null

  // If we have a non-expired JWT, use it
  if (jwt && !isJwtExpired(jwt)) {
    return jwt
  }

  // JWT expired or missing — try to refresh using session token
  if (bearerToken) {
    debug("JWT expired or missing, attempting refresh")
    const freshJwt = await refreshJwt(factoryUrl, bearerToken)
    if (freshJwt) return freshJwt

    // Refresh failed — fall back to bearer token (works when JWKS is not configured)
    debug("JWT refresh failed, falling back to bearer token")
    return bearerToken
  }

  return jwt ?? null
}

function truncatePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(payload)
  if (json.length <= MAX_PAYLOAD_BYTES) return payload

  return {
    _truncated: true,
    _originalSizeBytes: json.length,
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
    const factoryUrl = getFactoryUrl()
    const token = await getAuthToken(factoryUrl)
    if (!token) {
      debug("no dx session token found, skipping")
      return
    }

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
