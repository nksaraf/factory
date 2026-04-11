/**
 * Outbox Relay — polls org.event_outbox for pending events and
 * publishes them to NATS JetStream.
 *
 * Guarantees at-least-once delivery to NATS with Postgres as
 * the source of truth. If NATS is down, events queue in the
 * outbox and drain when NATS recovers.
 */
import { eq } from "drizzle-orm"

import type { Database } from "../db/connection"
import { event, eventOutbox } from "../db/schema/org-v2"
import { logger } from "../logger"
import { publishToNats } from "./nats"
import { type OperationRunner, createOperationRunner } from "./operations"

const MAX_RETRIES = 5
const BATCH_SIZE = 100

/**
 * Process pending outbox entries: publish to NATS and mark as published.
 * Returns the count of successfully published events.
 */
export async function processOutbox(db: Database): Promise<number> {
  const pending = await db
    .select({
      eventId: eventOutbox.eventId,
      attempts: eventOutbox.attempts,
      topic: event.topic,
      source: event.source,
      severity: event.severity,
      correlationId: event.correlationId,
      parentEventId: event.parentEventId,
      principalId: event.principalId,
      entityKind: event.entityKind,
      entityId: event.entityId,
      scopeKind: event.scopeKind,
      scopeId: event.scopeId,
      rawEventType: event.rawEventType,
      idempotencyKey: event.idempotencyKey,
      schemaVersion: event.schemaVersion,
      spec: event.spec,
      occurredAt: event.occurredAt,
      createdAt: event.createdAt,
    })
    .from(eventOutbox)
    .innerJoin(event, eq(eventOutbox.eventId, event.id))
    .where(eq(eventOutbox.status, "pending"))
    .orderBy(eventOutbox.createdAt)
    .limit(BATCH_SIZE)

  if (pending.length === 0) return 0

  let published = 0

  for (const row of pending) {
    const payload = JSON.stringify({
      id: row.eventId,
      topic: row.topic,
      source: row.source,
      severity: row.severity,
      correlationId: row.correlationId,
      parentEventId: row.parentEventId,
      principalId: row.principalId,
      entityKind: row.entityKind,
      entityId: row.entityId,
      scopeKind: row.scopeKind,
      scopeId: row.scopeId,
      rawEventType: row.rawEventType,
      idempotencyKey: row.idempotencyKey,
      schemaVersion: row.schemaVersion,
      spec: row.spec,
      occurredAt: row.occurredAt,
      createdAt: row.createdAt,
    })

    const result = await publishToNats(row.topic, payload)
    const newAttempts = row.attempts + 1

    if (result.ok) {
      await db
        .update(eventOutbox)
        .set({
          status: "published",
          attempts: newAttempts,
          publishedAt: new Date(),
        })
        .where(eq(eventOutbox.eventId, row.eventId))

      published++
    } else {
      const newStatus = newAttempts >= MAX_RETRIES ? "failed" : "pending"

      await db
        .update(eventOutbox)
        .set({
          status: newStatus,
          attempts: newAttempts,
          lastError: result.error ?? "NATS publish failed",
        })
        .where(eq(eventOutbox.eventId, row.eventId))

      if (newStatus === "failed") {
        logger.error(
          { eventId: row.eventId, topic: row.topic, attempts: newAttempts },
          "outbox-relay: event permanently failed after max retries"
        )
      } else {
        logger.warn(
          { eventId: row.eventId, topic: row.topic, attempts: newAttempts },
          "outbox-relay: publish failed, will retry"
        )
      }
    }
  }

  if (published > 0) {
    logger.info(
      { published, total: pending.length },
      "outbox-relay: batch processed"
    )
  }

  return published
}

/**
 * Start the outbox relay as a DB-tracked operation runner.
 * Polls every `intervalMs` (default: 1000ms).
 */
export function startOutboxRelayRunner(
  db: Database,
  opts?: { intervalMs?: number }
): OperationRunner {
  return createOperationRunner(db, {
    name: "outbox-relay",
    intervalMs: opts?.intervalMs ?? 1_000,
    async execute(log) {
      const published = await processOutbox(db)
      if (published > 0) {
        log.info({ published }, "outbox relay batch published")
      }
      return { published }
    },
  })
}
