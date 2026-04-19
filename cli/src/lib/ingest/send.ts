/**
 * HTTP event sender — POSTs IngestEvents to the Factory IDE hooks endpoint.
 * Uses {@link getFactoryApiToken} so we never send the opaque Better Auth
 * session token to `/api/v1/factory/*` (JWKS-verified JWT only).
 */
import { getFactoryApiToken } from "../../client.js"
import { readConfig, resolveFactoryUrl } from "../../config.js"
import type { IngestEvent, IngestResult } from "./common.js"

const MAX_PAYLOAD_BYTES = 64 * 1024

function jwtExpiresAt(token: string): number | null {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
    ) as { exp?: number }
    return typeof payload.exp === "number" ? payload.exp : null
  } catch {
    return null
  }
}

let _cachedAuth: { url: string; token: string } | null = null

async function ensureAuth(): Promise<{ url: string; token: string }> {
  const config = await readConfig()
  const factoryUrl = resolveFactoryUrl(config)
  const now = Date.now() / 1000

  if (_cachedAuth) {
    const exp = jwtExpiresAt(_cachedAuth.token)
    if (exp !== null && exp > now + 60) {
      return _cachedAuth
    }
  }

  const token = await getFactoryApiToken()
  if (!token) {
    throw new Error("Not authenticated. Run `dx factory login` first.")
  }

  _cachedAuth = { url: factoryUrl, token }
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
  slug: string
  content?: string
  type: string
  source?: string
  title?: string
  threadId?: string
  channelId?: string
  contentHash?: string
  spec: Record<string, unknown>
  dryRun?: boolean
}): Promise<{ success: boolean; id?: string; duplicate?: boolean }> {
  if (opts.dryRun) {
    console.log(
      JSON.stringify(
        {
          action: "upload-document",
          slug: opts.slug,
          type: opts.type,
          title: opts.title,
        },
        null,
        2
      )
    )
    return { success: true }
  }

  const auth = await ensureAuth()

  const body: Record<string, unknown> = {
    slug: opts.slug,
    type: opts.type,
    spec: opts.spec,
  }
  if (opts.source) body.source = opts.source
  if (opts.title) body.title = opts.title
  if (opts.threadId) body.threadId = opts.threadId
  if (opts.channelId) body.channelId = opts.channelId
  if (opts.contentHash) body.contentHash = opts.contentHash
  if (opts.content) {
    body.content = opts.content
    body.sizeBytes = Buffer.byteLength(opts.content, "utf-8")
  }

  const res = await fetch(`${auth.url}/api/v1/factory/documents/upsert`, {
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
    if (res.status === 409 || text.includes("unique")) {
      return { success: true, duplicate: true }
    }
    throw new Error(
      `Upload document failed: ${res.status} ${text.slice(0, 200)}`
    )
  }

  const data = (await res.json()) as any
  return { success: true, id: data?.id, duplicate: !!data?.upserted }
}

export async function uploadDocumentVersion(opts: {
  slug: string
  content: string
  source?: string
  threadId?: string
  spec?: Record<string, unknown>
  dryRun?: boolean
}): Promise<{ success: boolean; id?: string; version?: number }> {
  if (opts.dryRun) {
    console.log(
      JSON.stringify(
        {
          action: "upload-document-version",
          slug: opts.slug,
          source: opts.source,
        },
        null,
        2
      )
    )
    return { success: true }
  }

  const auth = await ensureAuth()

  const body: Record<string, unknown> = {
    content: opts.content,
  }
  if (opts.source) body.source = opts.source
  if (opts.threadId) body.threadId = opts.threadId
  if (opts.spec) body.spec = opts.spec

  const res = await fetch(
    `${auth.url}/api/v1/factory/documents/documents/${encodeURIComponent(opts.slug)}/versions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    }
  )

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(
      `Upload version failed: ${res.status} ${text.slice(0, 200)}`
    )
  }

  const data = (await res.json()) as any
  return { success: true, id: data?.id, version: data?.version }
}

export async function sendMessages(
  threadId: string,
  messages: Record<string, unknown>[],
  opts: { dryRun: boolean; verbose: boolean }
): Promise<{ inserted: number; toolCalls: number; exchanges: number }> {
  if (opts.dryRun) {
    console.log(
      JSON.stringify(
        { action: "ingest-messages", threadId, messageCount: messages.length },
        null,
        2
      )
    )
    return { inserted: messages.length, toolCalls: 0, exchanges: 0 }
  }

  const auth = await ensureAuth()

  // Batch in chunks of 100 to avoid payload size issues
  let totalInserted = 0
  let totalToolCalls = 0
  let totalExchanges = 0

  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100)

    const res = await fetch(`${auth.url}/api/v1/factory/messages/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({ threadId, messages: batch }),
      signal: AbortSignal.timeout(30000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(
        `Message ingest failed: ${res.status} ${text.slice(0, 200)}`
      )
    }

    const data = (await res.json()) as any
    totalInserted += data.inserted ?? 0
    totalToolCalls += data.toolCalls ?? 0
    totalExchanges += data.exchanges ?? 0

    if (opts.verbose) {
      console.error(
        `  [batch ${Math.floor(i / 100) + 1}] ${data.inserted} msgs, ${data.toolCalls} tools, ${data.exchanges} exchanges`
      )
    }
  }

  return {
    inserted: totalInserted,
    toolCalls: totalToolCalls,
    exchanges: totalExchanges,
  }
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
