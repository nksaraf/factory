/**
 * Unified event emission — writes to org.event + org.event_outbox atomically.
 *
 * All producers (reconciler, webhooks, agents, CLI, API mutations) call
 * emitEvent() to record canonical events. The transactional outbox pattern
 * ensures events are never lost — Postgres is the source of truth, and the
 * outbox relay publishes to NATS asynchronously.
 */
import type {
  EmitEventInput,
  EmitExternalEventInput,
  EventSpec,
} from "@smp/factory-shared/schemas/events"
import { eq } from "drizzle-orm"

import type { Database } from "../db/connection"
import { event, eventOutbox } from "../db/schema/org-v2"
import { logger } from "../logger"
import { canonicalize } from "./event-canonicalizers"
import { validateEventData } from "./event-schemas"
import { newId } from "./id"
import { resolveActorPrincipal } from "./webhook-events"

/**
 * Emit a canonical event. Writes to org.event + org.event_outbox
 * within the provided transaction (or db connection).
 *
 * Returns the event ID on success, or null if deduplicated.
 */
export async function emitEvent(
  db: Database,
  input: EmitEventInput
): Promise<string | null> {
  const {
    topic,
    source,
    severity = "info",
    principalId,
    entityKind,
    entityId,
    correlationId,
    parentEventId,
    rawEventType,
    rawPayload,
    data,
    idempotencyKey,
    occurredAt,
    scopeKind = "org",
    scopeId = "default",
    schemaVersion = 1,
  } = input

  // Validate data against schema registry (advisory, not blocking)
  const validation = validateEventData(topic, data, schemaVersion)
  if (!validation.valid) {
    logger.warn(
      { topic, errors: validation.errors },
      "emitEvent: payload validation failed"
    )
  }

  const id = newId("evt")
  const spec: EventSpec = {
    data,
    ...(rawPayload ? { rawPayload } : {}),
  }

  const eventValues = {
    id,
    topic,
    source,
    severity,
    correlationId: correlationId ?? null,
    parentEventId: parentEventId ?? null,
    principalId: principalId ?? null,
    entityKind: entityKind ?? null,
    entityId: entityId ?? null,
    scopeKind,
    scopeId,
    rawEventType: rawEventType ?? null,
    idempotencyKey: idempotencyKey ?? null,
    schemaVersion,
    spec,
    occurredAt: occurredAt ?? new Date(),
  }

  // Atomic insert: event + outbox in one transaction.
  // Uses ON CONFLICT DO NOTHING for idempotency to avoid TOCTOU races
  // when concurrent webhook retries fire with the same deliveryId.
  const inserted = await db.transaction(async (tx) => {
    const rows = idempotencyKey
      ? await tx
          .insert(event)
          .values(eventValues)
          .onConflictDoNothing({ target: event.idempotencyKey })
          .returning({ id: event.id })
      : await tx.insert(event).values(eventValues).returning({ id: event.id })

    if (rows.length === 0) return null

    await tx.insert(eventOutbox).values({ eventId: id })
    return id
  })

  if (!inserted) {
    logger.debug({ idempotencyKey, topic }, "emitEvent: deduplicated")
    return null
  }

  logger.info(
    { eventId: id, topic, source, severity, entityKind, entityId },
    "emitEvent: recorded"
  )

  // Bridge to legacy workflow event subscriptions
  await bridgeToWorkflowSubscriptions(db, topic, data).catch((err) => {
    logger.warn(
      { eventId: id, topic, err },
      "emitEvent: workflow bridge failed"
    )
  })

  return id
}

/**
 * Emit a canonical event from an external source (GitHub, Slack, Jira, etc.).
 * Handles canonicalization, idempotency key generation, and principal resolution.
 */
export async function emitExternalEvent(
  db: Database,
  input: EmitExternalEventInput
): Promise<string | null> {
  const {
    source,
    eventType,
    payload,
    providerId,
    deliveryId,
    actorExternalId,
    entityKind: inputEntityKind,
    entityId: inputEntityId,
  } = input

  // Resolve principal from external identity
  let principalId: string | undefined
  if (actorExternalId) {
    principalId =
      (await resolveActorPrincipal(db, source, actorExternalId)) ?? undefined
  }

  // Canonicalize
  const canonical = canonicalize({ source, eventType, payload })

  return emitEvent(db, {
    topic: canonical.topic,
    source,
    severity: canonical.severity,
    principalId,
    entityKind: inputEntityKind ?? canonical.entityKind,
    entityId: inputEntityId ?? canonical.entityId,
    rawEventType: eventType,
    rawPayload: payload,
    data: canonical.data,
    idempotencyKey: `${source}:${providerId}:${deliveryId}`,
  })
}

/**
 * Bridge: translate new canonical topic to legacy event name
 * and wake any matching workflow subscriptions.
 *
 * Maps "ops.workbench.ready" -> "workbench.ready" (strips domain prefix)
 */
async function bridgeToWorkflowSubscriptions(
  db: Database,
  topic: string,
  data: Record<string, unknown>
): Promise<void> {
  const { emitEvent: legacyEmitEvent } = await import("./workflow-events")

  // Strip the domain prefix: "ops.workbench.ready" -> "workbench.ready"
  const parts = topic.split(".")
  if (parts.length < 3) return

  const legacyEventName = parts.slice(1).join(".")
  await legacyEmitEvent(db, legacyEventName, data)
}
