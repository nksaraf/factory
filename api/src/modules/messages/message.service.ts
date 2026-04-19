/**
 * Message ingest service — writes IRMessages to org.message with:
 * - tool_call projection (extracts tool_use/tool_result pairs into org.tool_call)
 * - exchange materialization (groups user→assistant spans into org.exchange)
 * - event emission (publishes to NATS via outbox for real-time subscribers)
 */
import { eq, sql, and, desc } from "drizzle-orm"
import type { Database } from "../../db/connection"
import { message, exchange, toolCall, thread } from "../../db/schema/org"
import { newId } from "../../lib/id"
import { emitEvent } from "../../lib/events"
import { logger } from "../../logger"
import type { IRMessage } from "@smp/factory-shared/schemas/message-ir"

const log = logger.child({ module: "message-service" })

// ── Insert messages ─────────────────────────────────────────

export async function ingestMessages(
  db: Database,
  threadId: string,
  messages: IRMessage[],
  opts?: { principalId?: string; skipEvents?: boolean }
): Promise<{ inserted: number; toolCalls: number; exchanges: number }> {
  let inserted = 0
  let toolCallCount = 0
  let exchangeCount = 0

  for (const msg of messages) {
    const msgId = msg.id.startsWith("msg_") ? msg.id : newId("msg")
    const startedAt =
      startedAt instanceof Date
        ? startedAt
        : new Date(startedAt as unknown as string)
    const completedAt = msg.completedAt
      ? msg.completedAt instanceof Date
        ? msg.completedAt
        : new Date(msg.completedAt as unknown as string)
      : null

    await db
      .insert(message)
      .values({
        id: msgId,
        threadId,
        parentId: msg.parentId,
        role: msg.role,
        source: msg.source,
        content: msg.content as any,
        startedAt,
        completedAt,
        spec: {
          sourceMessageId: msg.id,
          model: msg.model,
          stopReason: msg.stopReason,
          usage: msg.usage,
        } as any,
      })
      .onConflictDoNothing()

    inserted++

    // Tool call projection: extract tool_use blocks from assistant messages
    if (msg.role === "assistant") {
      for (const block of msg.content) {
        if (block.type === "tool_use") {
          const b = block as Record<string, unknown>
          const toolId = b.id as string
          await db
            .insert(toolCall)
            .values({
              id: toolId,
              threadId,
              messageId: msgId,
              name: b.name as string,
              input: b.input as Record<string, unknown>,
              status: "pending",
              startedAt,
              spec: {} as any,
            })
            .onConflictDoNothing()
          toolCallCount++
        }
      }
    }

    // Tool result pairing: match tool_result blocks to pending tool_calls
    if (msg.role === "user") {
      for (const block of msg.content) {
        if (block.type === "tool_result") {
          const b = block as Record<string, unknown>
          const toolUseId = b.tool_use_id as string
          await db
            .update(toolCall)
            .set({
              result: (typeof b.content === "string"
                ? { text: b.content }
                : { blocks: b.content }) as any,
              resultMessageId: msgId,
              status: b.is_error ? "errored" : "completed",
              isError: (b.is_error as boolean) ?? false,
              endedAt: startedAt,
            })
            .where(eq(toolCall.id, toolUseId))
        }
      }
    }

    // Exchange materialization
    if (msg.role === "user") {
      const hasText = msg.content.some(
        (b: Record<string, unknown>) => b.type === "text"
      )
      const hasToolResult = msg.content.some(
        (b: Record<string, unknown>) => b.type === "tool_result"
      )

      if (hasText && !hasToolResult) {
        // Close any open exchange as interrupted
        await db
          .update(exchange)
          .set({
            status: "interrupted",
            endedAt: startedAt,
            updatedAt: new Date(),
          })
          .where(
            and(eq(exchange.threadId, threadId), eq(exchange.status, "running"))
          )

        // Open new exchange
        await db.insert(exchange).values({
          id: newId("exch"),
          threadId,
          triggerMessageId: msgId,
          status: "running",
          startedAt: startedAt,
          spec: {} as any,
        })
        exchangeCount++
      }
    }

    if (
      msg.role === "assistant" &&
      (msg.stopReason === "end_turn" || msg.stopReason === "stop_sequence")
    ) {
      // Close current exchange
      const openExchanges = await db
        .select({ id: exchange.id })
        .from(exchange)
        .where(
          and(eq(exchange.threadId, threadId), eq(exchange.status, "running"))
        )
        .limit(1)

      if (openExchanges.length > 0) {
        await db
          .update(exchange)
          .set({
            terminalMessageId: msgId,
            status: "completed",
            endedAt: startedAt,
            spec: await computeExchangeStats(db, threadId, openExchanges[0].id),
            updatedAt: new Date(),
          })
          .where(eq(exchange.id, openExchanges[0].id))
      }
    }

    // Emit event for real-time subscribers
    if (!opts?.skipEvents) {
      await emitEvent(db, {
        topic: "org.thread.message_created",
        source: msg.source,
        entityKind: "thread",
        entityId: threadId,
        principalId: opts?.principalId,
        data: {
          messageId: msgId,
          threadId,
          role: msg.role,
          sequence: msg.sequence,
        },
      }).catch((err) => {
        log.warn({ err, msgId }, "failed to emit message event")
      })
    }
  }

  return { inserted, toolCalls: toolCallCount, exchanges: exchangeCount }
}

// ── Exchange stats ──────────────────────────────────────────

async function computeExchangeStats(
  db: Database,
  threadId: string,
  exchangeId: string
): Promise<Record<string, unknown>> {
  const rows = await db
    .select({
      toolCallCount: sql<number>`count(*)`.as("toolCallCount"),
    })
    .from(toolCall)
    .where(
      and(eq(toolCall.threadId, threadId), eq(toolCall.exchangeId, exchangeId))
    )

  return {
    toolCallCount: rows[0]?.toolCallCount ?? 0,
  } as any
}
