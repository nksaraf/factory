/**
 * HTTP event sender — POSTs IngestEvents to the Factory IDE hooks endpoint.
 * Uses the CLI's existing auth infrastructure (readConfig, readSession).
 */
import { readConfig, resolveFactoryUrl } from "../../config.js"
import { readSession, writeSession } from "../../session-token.js"
import type { IngestEvent, IngestResult } from "./common.js"

const MAX_PAYLOAD_BYTES = 64 * 1024

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

async function refreshJwt(
  factoryUrl: string,
  authBasePath: string,
  bearerToken: string
): Promise<string | null> {
  try {
    const res = await fetch(`${factoryUrl}${authBasePath}/get-session`, {
      method: "GET",
      headers: { Authorization: `Bearer ${bearerToken}` },
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return null
    // JWT comes back in the set-auth-jwt response header
    const headerJwt = res.headers.get("set-auth-jwt")
    if (headerJwt) {
      await writeSession({ jwt: headerJwt })
      return headerJwt
    }
    // Fallback: check JSON body
    const data = (await res.json()) as any
    const bodyJwt = data?.session?.jwt ?? data?.jwt
    if (bodyJwt) {
      await writeSession({ jwt: bodyJwt })
      return bodyJwt
    }
    return null
  } catch {
    return null
  }
}

let _cachedAuth: {
  url: string
  token: string
  bearerToken?: string
  authBasePath: string
} | null = null

async function ensureAuth(): Promise<{ url: string; token: string }> {
  // Re-validate cached JWT hasn't expired mid-scan
  if (_cachedAuth && !isJwtExpired(_cachedAuth.token)) return _cachedAuth
  // If JWT expired but we have a bearer token, refresh
  if (
    _cachedAuth &&
    isJwtExpired(_cachedAuth.token) &&
    _cachedAuth.bearerToken
  ) {
    const fresh = await refreshJwt(
      _cachedAuth.url,
      _cachedAuth.authBasePath,
      _cachedAuth.bearerToken
    )
    if (fresh) {
      _cachedAuth.token = fresh
      return _cachedAuth
    }
  }

  const config = await readConfig()
  const factoryUrl = resolveFactoryUrl(config)
  const session = await readSession()
  const { bearerToken, jwt } = session

  if (!bearerToken && !jwt) {
    throw new Error("Not authenticated. Run `dx setup` first.")
  }

  let token: string | undefined

  // Try JWT first
  if (jwt && !isJwtExpired(jwt)) {
    token = jwt
  }

  // Refresh JWT if we have a bearer token
  if (!token && bearerToken) {
    const fresh = await refreshJwt(factoryUrl, config.authBasePath, bearerToken)
    if (fresh) {
      token = fresh
    } else {
      token = bearerToken
    }
  }

  if (!token) {
    token = jwt ?? undefined
  }

  if (!token) {
    throw new Error("Not authenticated. Run `dx setup` first.")
  }

  _cachedAuth = {
    url: factoryUrl,
    token,
    bearerToken,
    authBasePath: config.authBasePath,
  }
  return _cachedAuth
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

export async function sendEvent(
  event: IngestEvent
): Promise<{ success: boolean; duplicate?: boolean }> {
  const auth = await ensureAuth()

  // Only send properties the IngestBody schema expects (additionalProperties: false)
  const body = {
    source: event.source,
    deliveryId: event.deliveryId,
    eventType: event.eventType,
    sessionId: event.sessionId,
    timestamp: event.timestamp,
    ...(event.action ? { action: event.action } : {}),
    ...(event.cwd ? { cwd: event.cwd } : {}),
    ...(event.project ? { project: event.project } : {}),
    payload: event.payload ? truncatePayload(event.payload) : {},
  }

  const res = await fetch(`${auth.url}/api/v1/factory/ide-hooks/events`, {
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

export async function uploadDocument(opts: {
  path: string
  content: string
  type: string
  source?: string
  title?: string
  threadId?: string
  channelId?: string
  version?: number
  parentId?: string
  contentHash?: string
  spec: Record<string, unknown>
  dryRun?: boolean
}): Promise<{ success: boolean; id?: string; duplicate?: boolean }> {
  if (opts.dryRun) {
    console.log(
      JSON.stringify(
        {
          action: "upload-document",
          path: opts.path,
          type: opts.type,
          title: opts.title,
          version: opts.version,
        },
        null,
        2
      )
    )
    return { success: true }
  }

  const auth = await ensureAuth()

  const body: Record<string, unknown> = {
    path: opts.path,
    type: opts.type,
    spec: opts.spec,
  }
  if (opts.source) body.source = opts.source
  if (opts.title) body.title = opts.title
  if (opts.threadId) body.threadId = opts.threadId
  if (opts.channelId) body.channelId = opts.channelId
  if (opts.version != null) body.version = opts.version
  if (opts.parentId) body.parentId = opts.parentId
  if (opts.contentHash) body.contentHash = opts.contentHash
  if (opts.content) {
    body.content = opts.content
    body.sizeBytes = Buffer.byteLength(opts.content, "utf-8")
  }

  const res = await fetch(`${auth.url}/api/v1/factory/documents/documents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    // Duplicate path → treat as success
    if (res.status === 409 || text.includes("unique")) {
      return { success: true, duplicate: true }
    }
    throw new Error(
      `Upload document failed: ${res.status} ${text.slice(0, 200)}`
    )
  }

  const data = (await res.json()) as any
  return { success: true, id: data?.id }
}

export async function sendBatch(
  events: IngestEvent[],
  opts: { dryRun: boolean; verbose: boolean }
): Promise<IngestResult> {
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
