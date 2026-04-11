import { toAiMessages } from "chat"
import { and, eq, sql } from "drizzle-orm"

import {
  channel,
  identityLink,
  principal,
  thread,
  threadTurn,
} from "../../db/schema/org-v2"
import { logger } from "../../logger"
import { createAgentSession } from "./agent"
import { bot } from "./bot"
import { getChatDb } from "./db"
import { emitAgentEvent } from "./events"

const log = logger.child({ module: "chat-handlers" })

// ── Helpers ──────────────────────────────────────────────────────────

/** Resolved actor identity from an external platform user. */
interface ResolvedActor {
  principalId: string | null
  principalName: string | null
  principalEmail: string | null
  externalId: string
}

/** Resolve a Slack user ID to a factory principal. */
async function resolveActor(slackUserId: string): Promise<ResolvedActor> {
  const db = getChatDb()
  const rows = await db
    .select({
      principalId: identityLink.principalId,
      principalName: principal.name,
      principalEmail: sql<string>`${principal.spec}->>'email'`,
    })
    .from(identityLink)
    .innerJoin(principal, eq(identityLink.principalId, principal.id))
    .where(
      and(
        eq(identityLink.type, "slack"),
        eq(identityLink.externalId, slackUserId)
      )
    )
    .limit(1)

  const match = rows[0]
  if (match) {
    log.info(
      {
        slackUserId,
        principalId: match.principalId,
        name: match.principalName,
      },
      "Resolved Slack user to principal"
    )
  } else {
    log.warn({ slackUserId }, "No principal found for Slack user")
  }

  return {
    principalId: match?.principalId ?? null,
    principalName: match?.principalName ?? null,
    principalEmail: match?.principalEmail ?? null,
    externalId: slackUserId,
  }
}

/** Parse a Chat SDK thread ID ("slack:CHANNEL:THREAD_TS") into parts. */
export function parseSlackThreadId(threadId: string) {
  const parts = threadId.split(":")
  return { slackChannelId: parts[1] ?? "", slackThreadTs: parts[2] ?? "" }
}

/** Find or create a channel row for a Slack channel. */
export async function ensureChannel(slackChannelId: string): Promise<string> {
  const db = getChatDb()
  const existing = await db
    .select({ id: channel.id })
    .from(channel)
    .where(
      and(eq(channel.kind, "slack"), eq(channel.externalId, slackChannelId))
    )
    .limit(1)

  if (existing[0]) return existing[0].id

  const [row] = await db
    .insert(channel)
    .values({
      kind: "slack",
      externalId: slackChannelId,
      status: "active",
      spec: {},
    })
    .onConflictDoNothing()
    .returning({ id: channel.id })

  // Race: another request may have inserted — re-query
  if (!row) {
    const [fallback] = await db
      .select({ id: channel.id })
      .from(channel)
      .where(
        and(eq(channel.kind, "slack"), eq(channel.externalId, slackChannelId))
      )
      .limit(1)
    if (!fallback)
      throw new Error(
        `ensureChannel: row vanished for externalId=${slackChannelId}`
      )
    return fallback.id
  }

  return row.id
}

/** Find or create a thread row for a Slack conversation. Returns the thread ID. */
export async function ensureThread(
  chatSdkThreadId: string,
  channelId: string,
  actor: ResolvedActor
): Promise<string> {
  const db = getChatDb()
  const existing = await db
    .select({ id: thread.id })
    .from(thread)
    .where(
      and(eq(thread.source, "slack"), eq(thread.externalId, chatSdkThreadId))
    )
    .limit(1)

  if (existing[0]) return existing[0].id

  const [row] = await db
    .insert(thread)
    .values({
      type: "chat",
      source: "slack",
      externalId: chatSdkThreadId,
      principalId: actor.principalId,
      status: "active",
      channelId,
      startedAt: new Date(),
      spec: {
        participants: [actor.externalId],
      },
    })
    .onConflictDoNothing()
    .returning({ id: thread.id })

  if (!row) {
    const [fallback] = await db
      .select({ id: thread.id })
      .from(thread)
      .where(
        and(eq(thread.source, "slack"), eq(thread.externalId, chatSdkThreadId))
      )
      .limit(1)
    if (!fallback)
      throw new Error(
        `ensureThread: row vanished for externalId=${chatSdkThreadId}`
      )
    return fallback.id
  }

  return row.id
}

/** Append a turn to a thread (atomic turnIndex via subquery). */
export async function recordTurn(
  threadId: string,
  role: "user" | "assistant",
  message: string,
  authorUserId?: string,
  toolCalls?: Array<{ tool_name: string; tool_input: string }>
) {
  const db = getChatDb()

  // Map snake_case (webhook event standard) → camelCase (ThreadTurnSpec schema)
  const specToolCalls = toolCalls?.length
    ? toolCalls.map((tc) => ({ name: tc.tool_name, input: tc.tool_input }))
    : undefined

  await db.insert(threadTurn).values({
    threadId,
    turnIndex: sql`(SELECT coalesce(max(${threadTurn.turnIndex}), -1) + 1 FROM ${threadTurn} WHERE ${threadTurn.threadId} = ${threadId})`,
    role,
    spec: {
      message,
      timestamp: new Date().toISOString(),
      ...(authorUserId ? { prompt: `slack:${authorUserId}` } : {}),
      ...(specToolCalls ? { toolCalls: specToolCalls } : {}),
    },
  })
}

// ── Handlers ─────────────────────────────────────────────────────────

bot.onNewMention(async (chatThread, message) => {
  const { slackChannelId } = parseSlackThreadId(chatThread.id)
  const actor = await resolveActor(message.author.userId)

  log.info(
    {
      threadId: chatThread.id,
      author: actor.externalId,
      principalId: actor.principalId,
      principalName: actor.principalName,
      text: message.text?.slice(0, 80),
    },
    "New mention"
  )

  try {
    const channelId = await ensureChannel(slackChannelId)
    const threadId = await ensureThread(chatThread.id, channelId, actor)
    await recordTurn(threadId, "user", message.text ?? "", actor.externalId)

    // Subscribe so follow-ups route to onSubscribedMessage
    await chatThread.subscribe()

    const query = message.text?.trim()
    if (!query) {
      await chatThread.post(
        "Hey! Mention me with a question about the factory and I'll look it up for you."
      )
      return
    }

    // Build actor context for the agent
    const actorContext = actor.principalName
      ? `The user talking to you is ${actor.principalName}${actor.principalEmail ? ` (${actor.principalEmail})` : ""}.`
      : `The user's Slack ID is ${actor.externalId} (no linked principal found).`

    // Fire-and-forget: don't block typing indicator on event recording
    emitAgentEvent(threadId, "session.start", { source: "slack" })
    emitAgentEvent(threadId, "prompt.submit", {
      prompt: query.slice(0, 4096),
    })

    await chatThread.startTyping("Thinking...")
    const session = await createAgentSession(threadId)
    const result = await session.stream({
      messages: [
        { role: "system" as const, content: actorContext },
        { role: "user" as const, content: query },
      ],
    })

    await chatThread.post(result.fullStream)
    const replyText = await result.text

    await recordTurn(
      threadId,
      "assistant",
      replyText,
      undefined,
      session.getToolCalls()
    )
    emitAgentEvent(threadId, "agent.stop", {
      toolCallCount: session.getToolCalls().length,
      toolsUsed: session.getToolsUsed(),
    })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"
    log.error({ err, threadId: chatThread.id }, "Failed to handle mention")

    try {
      const channelId = await ensureChannel(slackChannelId)
      const threadId = await ensureThread(chatThread.id, channelId, actor)
      await recordTurn(threadId, "assistant", `[error] ${errMsg}`)
    } catch (_) {
      // Best-effort
    }

    await chatThread
      .post(`Sorry, something went wrong: ${errMsg}`)
      .catch(() => {})
  }
})

bot.onSubscribedMessage(async (chatThread, message) => {
  // Skip bot's own messages
  if (message.author.isMe) return

  const { slackChannelId } = parseSlackThreadId(chatThread.id)
  const actor = await resolveActor(message.author.userId)

  log.info(
    {
      threadId: chatThread.id,
      author: actor.externalId,
      principalId: actor.principalId,
      principalName: actor.principalName,
      text: message.text?.slice(0, 80),
    },
    "Subscribed message"
  )

  try {
    const channelId = await ensureChannel(slackChannelId)
    const threadId = await ensureThread(chatThread.id, channelId, actor)
    await recordTurn(threadId, "user", message.text ?? "", actor.externalId)

    const query = message.text?.trim()
    if (!query) return

    // Follow-up turn within an existing session — no session.start/session.end
    emitAgentEvent(threadId, "prompt.submit", {
      prompt: query.slice(0, 4096),
    })

    await chatThread.startTyping("Thinking...")

    // Build conversation history from Chat SDK thread
    const threadMessages = []
    for await (const msg of chatThread.allMessages) {
      threadMessages.push(msg)
    }
    const history = await toAiMessages(threadMessages)

    // Prepend actor context
    const actorContext = actor.principalName
      ? `The user talking to you is ${actor.principalName}${actor.principalEmail ? ` (${actor.principalEmail})` : ""}.`
      : `The user's Slack ID is ${actor.externalId} (no linked principal found).`

    const session = await createAgentSession(threadId)
    const result = await session.stream({
      messages: [
        { role: "system" as const, content: actorContext },
        ...history,
      ],
    })

    await chatThread.post(result.fullStream)
    const replyText = await result.text

    await recordTurn(
      threadId,
      "assistant",
      replyText,
      undefined,
      session.getToolCalls()
    )
    emitAgentEvent(threadId, "agent.stop", {
      toolCallCount: session.getToolCalls().length,
      toolsUsed: session.getToolsUsed(),
    })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"
    log.error({ err, threadId: chatThread.id }, "Failed to handle message")

    try {
      const channelId = await ensureChannel(slackChannelId)
      const threadId = await ensureThread(chatThread.id, channelId, actor)
      await recordTurn(threadId, "assistant", `[error] ${errMsg}`)
    } catch (_) {
      // Best-effort
    }

    await chatThread
      .post(`Sorry, something went wrong: ${errMsg}`)
      .catch(() => {})
  }
})

// ── Reaction handling ─────────────────────────────────────────────────

/** Emoji categories for reaction-based session control. */
const POSITIVE_EMOJIS = new Set([
  "white_check_mark", // ✅
  "heavy_check_mark", // ✔️
  "ballot_box_with_check", // ☑️
  "100", // 💯
  "ok", // 🆗
  "ok_hand", // 👌
  "done", // (custom)
  "thumbsup", // 👍
  "+1", // 👍 (alias)
  "star", // ⭐
  "tada", // 🎉
  "raised_hands", // 🙌
])

const NEGATIVE_EMOJIS = new Set([
  "thumbsdown", // 👎
  "-1", // 👎 (alias)
  "x", // ❌
  "no_entry", // ⛔
  "no_entry_sign", // 🚫
  "confused", // 😕
  "thinking_face", // 🤔
  "face_with_raised_eyebrow", // 🤨
])

const RETRY_EMOJIS = new Set([
  "arrows_counterclockwise", // 🔄
  "repeat", // 🔁
  "recycle", // ♻️
])

type ReactionCategory = "positive" | "negative" | "retry"

function classifyReaction(rawEmoji: string): ReactionCategory | null {
  if (POSITIVE_EMOJIS.has(rawEmoji)) return "positive"
  if (NEGATIVE_EMOJIS.has(rawEmoji)) return "negative"
  if (RETRY_EMOJIS.has(rawEmoji)) return "retry"
  return null
}

bot.onReaction(async (event) => {
  if (!event.added) return

  const category = classifyReaction(event.rawEmoji)
  if (!category) return

  const { slackChannelId } = parseSlackThreadId(event.threadId)
  const actor = await resolveActor(event.user.userId)

  log.info(
    {
      threadId: event.threadId,
      user: actor.externalId,
      principalName: actor.principalName,
      emoji: event.rawEmoji,
      category,
    },
    `Reaction: ${category} (${event.rawEmoji})`
  )

  try {
    const channelId = await ensureChannel(slackChannelId)
    const threadId = await ensureThread(event.threadId, channelId, actor)
    const db = getChatDb()

    if (category === "positive") {
      await db
        .update(thread)
        .set({ status: "closed" })
        .where(eq(thread.id, threadId))

      emitAgentEvent(threadId, "session.end", {
        source: "slack",
        resolution: "positive",
        emoji: event.rawEmoji,
      })
    } else if (category === "negative") {
      // Reopen thread and ask for feedback
      await db
        .update(thread)
        .set({ status: "active" })
        .where(eq(thread.id, threadId))

      emitAgentEvent(threadId, "session.feedback", {
        source: "slack",
        sentiment: "negative",
        emoji: event.rawEmoji,
      })

      await event.thread.post(
        "Got it — that wasn't what you needed. Can you tell me what was wrong or what you were looking for? I'll try again."
      )
    } else if (category === "retry") {
      // Reopen and regenerate the last response
      await db
        .update(thread)
        .set({ status: "active" })
        .where(eq(thread.id, threadId))

      emitAgentEvent(threadId, "session.retry", {
        source: "slack",
        emoji: event.rawEmoji,
      })

      // Rebuild conversation history and re-run
      await event.thread.startTyping("Retrying...")

      const threadMessages = []
      for await (const msg of event.thread.allMessages) {
        threadMessages.push(msg)
      }
      const history = await toAiMessages(threadMessages)

      const actorContext = actor.principalName
        ? `The user talking to you is ${actor.principalName}${actor.principalEmail ? ` (${actor.principalEmail})` : ""}.`
        : `The user's Slack ID is ${actor.externalId} (no linked principal found).`

      const session = await createAgentSession(threadId)
      const result = await session.stream({
        messages: [
          { role: "system" as const, content: actorContext },
          ...history,
          {
            role: "user" as const,
            content:
              "The user reacted with a retry emoji — please try answering the last question again, perhaps with a different approach.",
          },
        ],
      })

      await event.thread.post(result.fullStream)
      const replyText = await result.text

      await recordTurn(
        threadId,
        "assistant",
        replyText,
        undefined,
        session.getToolCalls()
      )
      emitAgentEvent(threadId, "agent.stop", {
        toolCallCount: session.getToolCalls().length,
        toolsUsed: session.getToolsUsed(),
      })
    }
  } catch (err) {
    log.error(
      { err, threadId: event.threadId, emoji: event.rawEmoji },
      "Failed to handle reaction"
    )
  }
})
