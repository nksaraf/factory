/**
 * Lightweight Slack Web API client using curl subprocess.
 *
 * Bun polyfills node:https with its own socket layer which drops
 * connections to Slack's API. curl works fine from the same container,
 * so we shell out to curl for reliability.
 */
import { curlRequest } from "../lib/curl-http"

const SLACK_API = "https://slack.com/api"

interface SlackResponse {
  ok: boolean
  error?: string
  response_metadata?: { next_cursor?: string }
  [key: string]: unknown
}

/**
 * Call a Slack Web API method via curl subprocess.
 */
async function slackApiCall(
  method: string,
  token: string,
  body: Record<string, unknown> = {}
): Promise<SlackResponse> {
  const response = await curlRequest({
    url: `${SLACK_API}/${method}`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body,
  })
  return response.data as SlackResponse
}

/**
 * Paginate a Slack API method that uses cursor-based pagination.
 */
async function slackPaginate<T>(
  method: string,
  token: string,
  params: Record<string, unknown>,
  extractItems: (response: SlackResponse) => T[]
): Promise<T[]> {
  const items: T[] = []
  let cursor: string | undefined

  do {
    const body = { ...params, ...(cursor ? { cursor } : {}) }
    const result = await slackApiCall(method, token, body)
    if (!result.ok) {
      throw new Error(
        `Slack API ${method} failed: ${result.error ?? "unknown"}`
      )
    }
    items.push(...extractItems(result))
    cursor = result.response_metadata?.next_cursor || undefined
  } while (cursor)

  return items
}

// ── Public API ─────────────────────────────────────────────────

export const slack = {
  /** auth.test — verify token and get workspace info */
  async authTest(token: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const result = await slackApiCall("auth.test", token)
      return { ok: result.ok, error: result.error }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  },

  /** users.list — paginated list of all workspace members */
  async usersList(token: string, limit = 200): Promise<SlackMember[]> {
    return slackPaginate(
      "users.list",
      token,
      { limit },
      (r) => (r.members as SlackMember[]) ?? []
    )
  },

  /** users.info — single user lookup */
  async usersInfo(token: string, userId: string): Promise<SlackMember | null> {
    try {
      const result = await slackApiCall("users.info", token, { user: userId })
      if (!result.ok) return null
      return (result.user as SlackMember) ?? null
    } catch {
      return null
    }
  },

  /** conversations.list — paginated list of channels */
  async conversationsList(
    token: string,
    types = "public_channel,private_channel",
    limit = 200
  ): Promise<SlackChannel[]> {
    return slackPaginate(
      "conversations.list",
      token,
      { types, limit },
      (r) => (r.channels as SlackChannel[]) ?? []
    )
  },

  /** chat.postMessage — send a message */
  async chatPostMessage(
    token: string,
    opts: {
      channel: string
      text: string
      blocks?: unknown[]
      thread_ts?: string
    }
  ): Promise<{ ts: string }> {
    const result = await slackApiCall("chat.postMessage", token, opts)
    if (!result.ok) throw new Error(`chat.postMessage failed: ${result.error}`)
    return { ts: result.ts as string }
  },

  /** chat.update — update a message */
  async chatUpdate(
    token: string,
    opts: { channel: string; ts: string; text: string; blocks?: unknown[] }
  ): Promise<void> {
    const result = await slackApiCall("chat.update", token, opts)
    if (!result.ok) throw new Error(`chat.update failed: ${result.error}`)
  },
}

// ── Types (matching the subset we use from @slack/web-api) ─────

export interface SlackMember {
  id: string
  name?: string
  real_name?: string
  deleted?: boolean
  is_bot?: boolean
  profile?: {
    email?: string
    display_name?: string
    image_72?: string
    title?: string
    phone?: string
    status_text?: string
    status_emoji?: string
  }
}

export interface SlackChannel {
  id: string
  name?: string
  is_private?: boolean
  topic?: { value?: string }
  purpose?: { value?: string }
  num_members?: number
}
