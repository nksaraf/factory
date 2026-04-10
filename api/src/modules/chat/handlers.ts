import { toAiMessages } from "chat"
import { and, eq, sql } from "drizzle-orm"

import { channel, thread, threadTurn } from "../../db/schema/org-v2"
import { logger } from "../../logger"
import { getAgent } from "./agent"
import { bot } from "./bot"
import { getChatDb } from "./db"

const log = logger.child({ module: "chat-handlers" })

// ── Helpers ──────────────────────────────────────────────────────────

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
  authorUserId: string
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
      status: "active",
      channelId,
      startedAt: new Date(),
      spec: {
        participants: [authorUserId],
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
  authorUserId?: string
) {
  const db = getChatDb()

  await db.insert(threadTurn).values({
    threadId,
    turnIndex: sql`(SELECT coalesce(max(${threadTurn.turnIndex}), -1) + 1 FROM ${threadTurn} WHERE ${threadTurn.threadId} = ${threadId})`,
    role,
    spec: {
      message,
      timestamp: new Date().toISOString(),
      ...(authorUserId ? { prompt: `slack:${authorUserId}` } : {}),
    },
  })
}

// ── Handlers ─────────────────────────────────────────────────────────

bot.onNewMention(async (chatThread, message) => {
  const { slackChannelId } = parseSlackThreadId(chatThread.id)
  const authorId = message.author.userId

  log.info(
    {
      threadId: chatThread.id,
      author: authorId,
      text: message.text?.slice(0, 80),
    },
    "New mention"
  )

  try {
    const channelId = await ensureChannel(slackChannelId)
    const threadId = await ensureThread(chatThread.id, channelId, authorId)
    await recordTurn(threadId, "user", message.text ?? "", authorId)

    // Subscribe so follow-ups route to onSubscribedMessage
    await chatThread.subscribe()

    const query = message.text?.trim()
    if (!query) {
      await chatThread.post(
        "Hey! Mention me with a question about the factory and I'll look it up for you."
      )
      return
    }

    await chatThread.startTyping("Thinking...")
    const agent = await getAgent()
    const result = await agent.stream({
      messages: [{ role: "user" as const, content: query }],
    })

    await chatThread.post(result.fullStream)
    const replyText = await result.text
    await recordTurn(threadId, "assistant", replyText)
  } catch (err) {
    const errMsg =
      err instanceof Error ? err.message : "Unknown error"
    log.error({ err, threadId: chatThread.id }, "Failed to handle mention")

    // Record the error as a turn so it's visible in the thread history
    try {
      const channelId = await ensureChannel(slackChannelId)
      const threadId = await ensureThread(chatThread.id, channelId, authorId)
      await recordTurn(threadId, "assistant", `[error] ${errMsg}`)
    } catch (_) {
      // Best-effort — don't mask the original error
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
  const authorId = message.author.userId

  log.info(
    {
      threadId: chatThread.id,
      author: authorId,
      text: message.text?.slice(0, 80),
    },
    "Subscribed message"
  )

  try {
    const channelId = await ensureChannel(slackChannelId)
    const threadId = await ensureThread(chatThread.id, channelId, authorId)
    await recordTurn(threadId, "user", message.text ?? "", authorId)

    const query = message.text?.trim()
    if (!query) return

    await chatThread.startTyping("Thinking...")

    // Build conversation history from Chat SDK thread
    const threadMessages = []
    for await (const msg of chatThread.allMessages) {
      threadMessages.push(msg)
    }
    const history = await toAiMessages(threadMessages)

    const agent = await getAgent()
    const result = await agent.stream({ messages: history })

    await chatThread.post(result.fullStream)
    const replyText = await result.text
    await recordTurn(threadId, "assistant", replyText)
  } catch (err) {
    const errMsg =
      err instanceof Error ? err.message : "Unknown error"
    log.error({ err, threadId: chatThread.id }, "Failed to handle message")

    try {
      const channelId = await ensureChannel(slackChannelId)
      const threadId = await ensureThread(chatThread.id, channelId, authorId)
      await recordTurn(threadId, "assistant", `[error] ${errMsg}`)
    } catch (_) {
      // Best-effort
    }

    await chatThread
      .post(`Sorry, something went wrong: ${errMsg}`)
      .catch(() => {})
  }
})
