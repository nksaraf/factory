/**
 * Messages controller — bulk ingest IRMessages into org.message + org.tool_call
 * + org.exchange, and export thread transcripts for session reconstruction.
 *
 * POST  /messages/ingest               — bulk insert messages for a thread
 * GET   /messages/threads/:id/messages — list messages for a thread
 * GET   /messages/threads/:id/transcript — export as agent-native format
 */
import { eq, desc, asc } from "drizzle-orm"
import { Elysia, t } from "elysia"

import type { Database } from "../../db/connection"
import { message, exchange, toolCall, thread } from "../../db/schema/org"
import { logger } from "../../logger"
import { ingestMessages } from "./message.service"
import type {
  IRMessage,
  IRThread,
} from "@smp/factory-shared/schemas/message-ir"

const log = logger.child({ module: "messages" })

async function resolveThreadId(
  db: Database,
  threadIdOrExternalId: string
): Promise<string | null> {
  if (threadIdOrExternalId.startsWith("thrd_")) return threadIdOrExternalId
  const rows = await db
    .select({ id: thread.id })
    .from(thread)
    .where(eq(thread.externalId, threadIdOrExternalId))
    .limit(1)
  return rows[0]?.id ?? null
}

export function messagesController(db: Database) {
  return new Elysia({ prefix: "/messages" })

    .post(
      "/ingest",
      async ({ body, set }) => {
        const { threadId, messages: msgs, principalId } = body

        // Look up thread by ID or externalId (sessionId)
        let resolvedThreadId = threadId
        const byId = await db
          .select({ id: thread.id })
          .from(thread)
          .where(eq(thread.id, threadId))
          .limit(1)

        if (byId.length === 0) {
          const byExternal = await db
            .select({ id: thread.id })
            .from(thread)
            .where(eq(thread.externalId, threadId))
            .limit(1)

          if (byExternal.length === 0) {
            set.status = 404
            return { error: `Thread ${threadId} not found` }
          }
          resolvedThreadId = byExternal[0].id
        }

        try {
          const result = await ingestMessages(
            db,
            resolvedThreadId,
            msgs as any,
            { principalId }
          )
          set.status = 202
          return {
            success: true,
            ...result,
          }
        } catch (err) {
          log.error({ err, threadId }, "message ingest failed")
          set.status = 500
          return { error: "Ingest failed" }
        }
      },
      {
        body: t.Object({
          threadId: t.String(),
          principalId: t.Optional(t.String()),
          messages: t.Array(
            t.Object({
              id: t.String(),
              sequence: t.Number(),
              threadId: t.String(),
              parentId: t.Nullable(t.String()),
              role: t.String(),
              source: t.String(),
              content: t.Array(t.Any()),
              startedAt: t.String(),
              completedAt: t.Optional(t.Nullable(t.String())),
              model: t.Optional(t.String()),
              stopReason: t.Optional(t.String()),
              usage: t.Optional(
                t.Object({
                  inputTokens: t.Number(),
                  outputTokens: t.Number(),
                  cacheReadTokens: t.Number(),
                  cacheWriteTokens: t.Number(),
                })
              ),
              meta: t.Optional(t.Any()),
              sourceEntryIds: t.Array(t.String()),
            })
          ),
        }),
        detail: {
          tags: ["Messages"],
          summary: "Bulk ingest IRMessages into org.message",
        },
      }
    )

    .get(
      "/threads/:threadId/messages",
      async ({ params, query, set }) => {
        const tid = await resolveThreadId(db, params.threadId)
        if (!tid) {
          set.status = 404
          return { error: "Thread not found" }
        }
        const rows = await db
          .select()
          .from(message)
          .where(eq(message.threadId, tid))
          .orderBy(asc(message.startedAt))
          .limit(query.limit ?? 1000)

        return { messages: rows, count: rows.length }
      },
      {
        params: t.Object({ threadId: t.String() }),
        query: t.Object({ limit: t.Optional(t.Number()) }),
        detail: {
          tags: ["Messages"],
          summary: "List messages for a thread",
        },
      }
    )

    .get(
      "/threads/:threadId/exchanges",
      async ({ params, set }) => {
        const tid = await resolveThreadId(db, params.threadId)
        if (!tid) {
          set.status = 404
          return { error: "Thread not found" }
        }
        const rows = await db
          .select()
          .from(exchange)
          .where(eq(exchange.threadId, tid))
          .orderBy(asc(exchange.startedAt))

        return { exchanges: rows, count: rows.length }
      },
      {
        params: t.Object({ threadId: t.String() }),
        detail: {
          tags: ["Messages"],
          summary: "List exchanges for a thread",
        },
      }
    )

    .get(
      "/threads/:threadId/tool-calls",
      async ({ params, query, set }) => {
        const tid = await resolveThreadId(db, params.threadId)
        if (!tid) {
          set.status = 404
          return { error: "Thread not found" }
        }
        const rows = await db
          .select()
          .from(toolCall)
          .where(eq(toolCall.threadId, tid))
          .orderBy(asc(toolCall.startedAt))
          .limit(query.limit ?? 1000)

        return { toolCalls: rows, count: rows.length }
      },
      {
        params: t.Object({ threadId: t.String() }),
        query: t.Object({ limit: t.Optional(t.Number()) }),
        detail: {
          tags: ["Messages"],
          summary: "List tool calls for a thread",
        },
      }
    )

    .get(
      "/threads/:threadId/transcript",
      async ({ params, query, set }) => {
        const tid = await resolveThreadId(db, params.threadId)
        if (!tid) {
          set.status = 404
          return { error: "Thread not found" }
        }

        const [thrd] = await db
          .select()
          .from(thread)
          .where(eq(thread.id, tid))
          .limit(1)

        const rows = await db
          .select()
          .from(message)
          .where(eq(message.threadId, tid))
          .orderBy(asc(message.startedAt))

        if (rows.length === 0) {
          set.status = 404
          return { error: "No messages found for thread" }
        }

        const format = query.format ?? "json"

        if (format === "json") {
          return { messages: rows, thread: thrd }
        }

        if (format === "claude-code") {
          const irMessages: IRMessage[] = rows.map((row, i) => ({
            id: (row.spec as any)?.sourceMessageId ?? row.id,
            sequence: i,
            threadId: tid,
            parentId: row.parentId,
            role: row.role as "user" | "assistant" | "system",
            source: row.source,
            content: row.content as Record<string, unknown>[],
            startedAt: row.startedAt,
            completedAt: row.completedAt ?? undefined,
            model: (row.spec as any)?.model,
            stopReason: (row.spec as any)?.stopReason,
            usage: (row.spec as any)?.usage,
            meta: (row.spec as any)?.meta,
            sourceEntryIds: [(row.spec as any)?.sourceMessageId ?? row.id],
          }))

          const irThread: IRThread = {
            id: tid,
            parentThreadId: null,
            parentToolUseId: null,
            sessionId: thrd?.externalId ?? params.threadId,
            cwd: (thrd?.spec as any)?.cwd,
            gitBranch: thrd?.branch ?? undefined,
            model: (thrd?.spec as any)?.model,
            messages: irMessages,
            childThreads: [],
          }

          const { claudeCodeAdapter } =
            await import("@smp/factory-shared/adapters/claude-code.adapter")
          const result = claudeCodeAdapter.reconstructTranscript(irThread)

          set.headers["content-type"] = "application/x-ndjson"
          set.headers["content-disposition"] =
            `attachment; filename="${thrd?.externalId ?? params.threadId}.jsonl"`
          return result.text
        }

        set.headers["content-type"] = "application/x-ndjson"
        const lines = rows.map((row) => JSON.stringify(row))
        return lines.join("\n") + "\n"
      },
      {
        params: t.Object({ threadId: t.String() }),
        query: t.Object({
          format: t.Optional(t.String()),
        }),
        detail: {
          tags: ["Messages"],
          summary:
            "Export thread transcript (format: json, claude-code, ndjson)",
        },
      }
    )
}
