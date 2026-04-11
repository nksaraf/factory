/**
 * Ingestion client — POSTs events to the Factory IDE hooks endpoint.
 * Reuses auth logic from scripts/ide-hooks/lib/send-event.ts.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type { IngestEvent } from "./common"

const MAX_PAYLOAD_BYTES = 64 * 1024

function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}

function getDxConfigDir(): string {
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "dx")
}

function getSession(): { bearerToken?: string; jwt?: string } | null {
  const session = readJsonFile(join(getDxConfigDir(), "session.json"))
  if (!session) return null
  return {
    bearerToken: session.bearerToken as string | undefined,
    jwt: session.jwt as string | undefined,
  }
}

function isJwtExpired(jwt: string): boolean {
  try {
    const parts = jwt.split(".")
    if (parts.length !== 3) return true
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
    )
    return !payload.exp || Date.now() / 1000 > payload.exp - 60
  } catch {
    return true
  }
}

function getFactoryUrl(): string {
  if (process.env.FACTORY_API_URL) return process.env.FACTORY_API_URL
  if (process.env.DX_FACTORY_URL) return process.env.DX_FACTORY_URL
  const config = readJsonFile(join(getDxConfigDir(), "config.json"))
  const url = config?.factoryUrl as string | undefined
  if (url === "local") return "http://localhost:4100"
  return url && url.length > 0 ? url : "https://factory.lepton.software"
}

function getAuthBasePath(): string {
  const config = readJsonFile(join(getDxConfigDir(), "config.json"))
  return (config?.authBasePath as string) || "/api/auth"
}

async function refreshJwt(
  factoryUrl: string,
  bearerToken: string
): Promise<string | null> {
  try {
    const res = await fetch(`${factoryUrl}${getAuthBasePath()}/get-session`, {
      method: "GET",
      headers: { Authorization: `Bearer ${bearerToken}` },
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as any
    const newJwt = data?.session?.jwt ?? data?.jwt
    if (newJwt) {
      try {
        const sessionFile = join(getDxConfigDir(), "session.json")
        const session = readJsonFile(sessionFile) ?? {}
        session.jwt = newJwt
        writeFileSync(sessionFile, JSON.stringify(session, null, 2))
      } catch {}
      return newJwt
    }
    return null
  } catch {
    return null
  }
}

async function getAuthToken(factoryUrl: string): Promise<string | null> {
  const session = getSession()
  if (!session) return null
  const { bearerToken, jwt } = session
  if (!bearerToken && !jwt) return null
  if (jwt && !isJwtExpired(jwt)) return jwt
  if (bearerToken) {
    const fresh = await refreshJwt(factoryUrl, bearerToken)
    if (fresh) return fresh
    return bearerToken
  }
  return jwt ?? null
}

function truncatePayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
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
      })
    ),
  }
}

let _factoryUrl: string | null = null
let _authToken: string | null = null

async function ensureAuth(): Promise<{ url: string; token: string } | null> {
  if (!_factoryUrl) _factoryUrl = getFactoryUrl()
  if (!_authToken) _authToken = await getAuthToken(_factoryUrl)
  if (!_authToken) return null
  return { url: _factoryUrl, token: _authToken }
}

export async function sendEvent(
  event: IngestEvent
): Promise<{ success: boolean; duplicate?: boolean }> {
  const auth = await ensureAuth()
  if (!auth)
    throw new Error("No dx session token found. Run `dx auth login` first.")

  const body = {
    ...event,
    payload: event.payload ? truncatePayload(event.payload) : {},
  }

  const res = await fetch(`${auth.url}/api/factory/ide-hooks/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`POST failed: ${res.status} ${text.slice(0, 200)}`)
  }

  const data = (await res.json()) as any
  return { success: data.success, duplicate: data.duplicate }
}

export async function sendBatch(
  events: IngestEvent[],
  opts: { dryRun: boolean; verbose: boolean }
): Promise<{ sent: number; duplicates: number; errors: number }> {
  let sent = 0
  let duplicates = 0
  let errors = 0

  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    if (opts.dryRun) {
      console.log(JSON.stringify(event, null, 2))
      sent++
      continue
    }

    try {
      const result = await sendEvent(event)
      if (result.duplicate) {
        duplicates++
        if (opts.verbose) console.error(`  [dup] ${event.deliveryId}`)
      } else {
        sent++
        if (opts.verbose) console.error(`  [ok]  ${event.deliveryId}`)
      }
    } catch (err) {
      errors++
      console.error(`  [err] ${event.deliveryId}: ${err}`)
    }

    // Small delay every 10 events to avoid hammering
    if (i > 0 && i % 10 === 0) await new Promise((r) => setTimeout(r, 50))
  }

  return { sent, duplicates, errors }
}
