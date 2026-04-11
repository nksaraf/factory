/**
 * Slack surface helpers — auto-attach and post to Slack threads
 * that mirror IDE sessions (Claude Code, Cursor, Conductor).
 *
 * Uses the Chat SDK bot singleton for all Slack interactions.
 */
import { and, eq, sql } from "drizzle-orm"

import type { Database } from "../../db/connection"
import {
  channel,
  identityLink,
  thread,
  threadChannel,
} from "../../db/schema/org"
import { logger } from "../../logger"
import { adapters, bot } from "../chat/bot"
import { ensureChannel, parseSlackThreadId } from "../chat/handlers"

const log = logger.child({ module: "slack-surface" })

// ── Message formatting ───────────────────────────────────────

function formatStartMessage(
  source: string,
  payload: Record<string, any>
): string {
  const cwd = payload.cwd
    ? ` in \`${payload.cwd.split("/").slice(-2).join("/")}\``
    : ""
  const branch = payload.gitBranch ?? payload.branch
  const branchStr = branch ? ` (branch: \`${branch}\`)` : ""
  return `:large_green_circle: *${source}* session started${cwd}${branchStr}`
}

function formatUserMessage(prompt: string): string {
  const truncated = prompt.length > 500 ? prompt.slice(0, 497) + "..." : prompt
  return `:bust_in_silhouette: *User:*\n> ${truncated.replace(/\n/g, "\n> ")}`
}

function formatAssistantMessage(summary: string, source?: string): string {
  const label = source ? `*${source}:*` : "*Assistant:*"
  const truncated =
    summary.length > 3000 ? summary.slice(0, 2997) + "..." : summary
  return `:robot_face: ${label}\n${truncated}`
}

function formatEndMessage(spec: Record<string, any>): string {
  const turns = spec.turnCount ? `${spec.turnCount} turns` : ""
  const duration = spec.durationMinutes ? `${spec.durationMinutes}m` : ""
  const details = [turns, duration].filter(Boolean).join(", ")
  return `:red_circle: Session ended${details ? ` (${details})` : ""}`
}

// ── Core helpers ─────────────────────────────────────────────

/**
 * Look up a principal's Slack identity via the identityLink table.
 * Returns the Slack user ID (externalId) or null.
 */
async function lookupSlackIdentity(
  db: Database,
  principalId: string
): Promise<string | null> {
  const rows = await db
    .select({ externalId: identityLink.externalId })
    .from(identityLink)
    .where(
      and(
        eq(identityLink.principalId, principalId),
        eq(identityLink.type, "slack")
      )
    )
    .limit(1)

  return rows[0]?.externalId ?? null
}

/**
 * Find the thread row for a given session ID.
 */
export async function findThreadBySessionId(
  db: Database,
  sessionId: string
): Promise<{ id: string; spec: Record<string, any> } | null> {
  const rows = await db
    .select({ id: thread.id, spec: thread.spec })
    .from(thread)
    .where(eq(thread.externalId, sessionId))
    .limit(1)

  if (rows.length === 0) return null
  return { id: rows[0].id, spec: (rows[0].spec ?? {}) as Record<string, any> }
}

/**
 * Auto-attach a Slack surface to a thread.
 *
 * Called on session.start. If the principal has a linked Slack identity,
 * opens a DM (or uses a configured channel), posts a "Session started"
 * message, and creates a thread_channel row.
 *
 * Returns the thread_channel ID, or null if no Slack identity / adapter.
 */
export async function autoAttachSlackSurface(
  db: Database,
  threadId: string,
  principalId: string,
  source: string,
  payload: Record<string, any>
): Promise<string | null> {
  // 1. Check Slack adapter is available
  if (!adapters.slack) {
    log.debug("Slack adapter not configured — skipping auto-attach")
    return null
  }

  // 2. Look up Slack identity
  const slackUserId = await lookupSlackIdentity(db, principalId)
  if (!slackUserId) {
    log.debug({ principalId }, "No Slack identity — skipping auto-attach")
    return null
  }

  // 3. Ensure Chat SDK is initialized (normally lazy-init'd via webhooks)
  await bot.initialize()

  // 4. Open DM
  const dmThread = await bot.openDM(slackUserId)

  // 4. Post "Session started" message — this creates the Slack thread
  const startMsg = formatStartMessage(source, payload)
  const sent = await dmThread.post(startMsg)

  // 5. Parse the Slack thread info from the sent message
  const chatSdkThreadId = sent.threadId
  const { slackChannelId } = parseSlackThreadId(chatSdkThreadId)

  // 6. Ensure channel row exists
  const channelRowId = await ensureChannel(slackChannelId)

  // 7. Insert thread_channel surface
  const [row] = await db
    .insert(threadChannel)
    .values({
      threadId,
      channelId: channelRowId,
      role: "mirror",
      status: "connected",
      spec: {
        slackThreadTs: sent.id,
        chatSdkThreadId,
        connectedAt: new Date().toISOString(),
      } as any,
    })
    .returning({ id: threadChannel.id })

  log.info(
    {
      threadChannelId: row.id,
      threadId,
      slackUserId,
      chatSdkThreadId,
    },
    "Auto-attached Slack surface"
  )

  return row.id
}

/**
 * Post a message to all active Slack surfaces for a thread.
 *
 * Looks up connected thread_channel rows with Slack channels,
 * formats the message by role, and posts via the Chat SDK.
 */
export async function postToSurface(
  db: Database,
  threadId: string,
  message: string,
  role: "user" | "assistant" | "end",
  opts?: { source?: string; threadSpec?: Record<string, any> }
): Promise<void> {
  if (!adapters.slack) return

  // Find active Slack surfaces for this thread
  const surfaces = await db
    .select({
      id: threadChannel.id,
      spec: threadChannel.spec,
      channelKind: channel.kind,
    })
    .from(threadChannel)
    .innerJoin(channel, eq(threadChannel.channelId, channel.id))
    .where(
      and(
        eq(threadChannel.threadId, threadId),
        eq(threadChannel.status, "connected"),
        eq(channel.kind, "slack")
      )
    )

  if (surfaces.length === 0) return

  for (const surface of surfaces) {
    const spec = (surface.spec ?? {}) as Record<string, any>
    const chatSdkThreadId = spec.chatSdkThreadId as string | undefined
    if (!chatSdkThreadId) continue

    let formatted: string
    switch (role) {
      case "user":
        formatted = formatUserMessage(message)
        break
      case "assistant":
        formatted = formatAssistantMessage(message, opts?.source)
        break
      case "end":
        formatted = formatEndMessage(opts?.threadSpec ?? {})
        break
    }

    try {
      await adapters.slack.postMessage(chatSdkThreadId, formatted)
    } catch (err) {
      log.warn(
        { err, threadChannelId: surface.id, chatSdkThreadId },
        "Failed to post to Slack surface"
      )
    }
  }
}

/**
 * Detach all active surfaces for a thread.
 * Called on session.end to mark surfaces as detached.
 */
export async function detachSurfaces(
  db: Database,
  threadId: string
): Promise<void> {
  const detachedAt = new Date().toISOString()
  await db
    .update(threadChannel)
    .set({
      status: "detached",
      spec: sql`COALESCE(${threadChannel.spec}, '{}'::jsonb) || ${JSON.stringify({ detachedAt })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(threadChannel.threadId, threadId),
        eq(threadChannel.status, "connected")
      )
    )
}
