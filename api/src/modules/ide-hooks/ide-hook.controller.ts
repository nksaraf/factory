/**
 * IDE Hook Events — receives telemetry from Claude Code & Cursor hook scripts,
 * stores as org.webhook_event records linked to the authenticated principal.
 *
 * POST  /ide-hooks/events   — ingest a hook event
 * GET   /ide-hooks/events   — query hook events (with filters)
 */

import { Elysia, t } from "elysia"
import { and, eq, gte, lte, inArray, desc } from "drizzle-orm"

import type { Database } from "../../db/connection"
import { webhookEvent } from "../../db/schema/org-v2"
import { recordWebhookEvent } from "../../lib/webhook-events"
import { logger } from "../../logger"

const log = logger.child({ module: "ide-hooks" })

const VALID_SOURCES = ["claude-code", "cursor"] as const

const IngestBody = t.Object({
  source: t.Union([t.Literal("claude-code"), t.Literal("cursor")]),
  deliveryId: t.String(),
  eventType: t.String(),
  action: t.Optional(t.String()),
  sessionId: t.String(),
  timestamp: t.String(),
  cwd: t.Optional(t.String()),
  project: t.Optional(t.String()),
  payload: t.Optional(t.Any()),
})

export function ideHookController(db: Database) {
  return new Elysia({ prefix: "/ide-hooks" })

    // --- Ingest hook event ---
    .post(
      "/events",
      async ({ body, set, ...ctx }) => {
        const principalId = (ctx as unknown as { principalId: string }).principalId

        if (!principalId) {
          set.status = 401
          return { success: false, error: "unauthenticated" }
        }

        const eventId = await recordWebhookEvent(db, {
          source: body.source,
          providerId: principalId,
          deliveryId: body.deliveryId,
          eventType: body.eventType,
          normalizedEventType: body.eventType,
          actorId: principalId,
          action: body.action,
          payload: {
            sessionId: body.sessionId,
            timestamp: body.timestamp,
            cwd: body.cwd,
            project: body.project,
            ...((body.payload as Record<string, unknown>) ?? {}),
          },
        })

        if (eventId === null) {
          // Duplicate — idempotent success
          set.status = 200
          return { success: true, duplicate: true }
        }

        log.info(
          { source: body.source, eventType: body.eventType, principalId, eventId },
          "ide hook event recorded",
        )

        set.status = 202
        return { success: true, eventId }
      },
      {
        body: IngestBody,
        detail: { tags: ["IDE Hooks"], summary: "Ingest a hook event from Claude Code or Cursor" },
      },
    )

    // --- Query hook events ---
    .get(
      "/events",
      async ({ query, ...ctx }) => {
        const principalId = (ctx as unknown as { principalId: string }).principalId
        const conditions = [
          inArray(webhookEvent.source, [...VALID_SOURCES]),
          // Default scope: own events only. Pass ?principalId=* for all (future: admin check).
          eq(webhookEvent.providerId, query.principalId ?? principalId),
        ]

        if (query.source) {
          conditions.push(eq(webhookEvent.source, query.source))
        }
        if (query.eventType) {
          conditions.push(eq(webhookEvent.eventType, query.eventType))
        }
        if (query.from) {
          conditions.push(gte(webhookEvent.createdAt, new Date(query.from)))
        }
        if (query.to) {
          conditions.push(lte(webhookEvent.createdAt, new Date(query.to)))
        }

        const limit = Math.min(Number(query.limit ?? 50), 200)
        const offset = Number(query.offset ?? 0)

        const rows = await db
          .select()
          .from(webhookEvent)
          .where(and(...conditions))
          .orderBy(desc(webhookEvent.createdAt))
          .limit(limit)
          .offset(offset)

        return { events: rows, count: rows.length }
      },
      {
        query: t.Object({
          source: t.Optional(t.String()),
          principalId: t.Optional(t.String()),
          eventType: t.Optional(t.String()),
          from: t.Optional(t.String()),
          to: t.Optional(t.String()),
          limit: t.Optional(t.String()),
          offset: t.Optional(t.String()),
        }),
        detail: { tags: ["IDE Hooks"], summary: "Query IDE hook events" },
      },
    )
}
