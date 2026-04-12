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
  EventRef,
  EventSpec,
} from "@smp/factory-shared/schemas/events"
import { and, eq, gt } from "drizzle-orm"

import type { Database } from "../db/connection"
import { event, eventOutbox, eventSubscription } from "../db/schema/org"
import { logger } from "../logger"
import { matchTopic } from "../modules/events/topic-matcher"
import { canonicalize } from "./event-canonicalizers"
import {
  resolveGitHubEntities,
  resolveJiraEntities,
  resolveSlackEntities,
} from "./event-entity-resolver"
import { validateEventData } from "./event-schemas"
import { newId } from "./id"
import { send } from "./workflow-engine"
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
    refs,
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
    ...(refs && refs.length > 0 ? { refs } : {}),
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

  await matchSubscriptions(db, topic, severity, scopeKind, scopeId, data).catch(
    (err) => {
      logger.warn(
        { eventId: id, topic, err },
        "emitEvent: subscription matching failed"
      )
    }
  )

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

  // Resolve entity refs (best-effort, never fails)
  let refs: EventRef[] = []
  try {
    const resolvers: Record<
      string,
      (
        db: Database,
        providerId: string,
        payload: Record<string, unknown>
      ) => Promise<EventRef[]>
    > = {
      github: resolveGitHubEntities,
      slack: resolveSlackEntities,
      jira: resolveJiraEntities,
    }
    const resolver = resolvers[source]
    if (resolver) {
      refs = await resolver(db, providerId, payload)
    }
  } catch (err) {
    logger.warn(
      { source, providerId, err },
      "emitExternalEvent: entity resolution failed"
    )
  }

  // Add principal to refs so the full picture is in one place
  if (principalId) {
    refs.push({ kind: "principal", id: principalId, role: "context" })
  }

  // Set entityKind/entityId from the first "subject" ref if not already set
  const subjectRef = refs.find((r) => r.role === "subject")
  const resolvedEntityKind =
    inputEntityKind ?? canonical.entityKind ?? subjectRef?.kind
  const resolvedEntityId = inputEntityId ?? canonical.entityId ?? subjectRef?.id

  return emitEvent(db, {
    topic: canonical.topic,
    source,
    severity: canonical.severity,
    principalId,
    entityKind: resolvedEntityKind,
    entityId: resolvedEntityId,
    rawEventType: eventType,
    rawPayload: payload,
    data: canonical.data,
    refs,
    idempotencyKey: `${source}:${providerId}:${deliveryId}`,
    schemaVersion: 1,
  })
}

/**
 * Match an event against all active trigger subscriptions.
 * Wakes matching workflows via DBOS send(), marks triggers as fired.
 * Stream subscriptions are handled by the NATS notification router.
 */
async function matchSubscriptions(
  db: Database,
  topic: string,
  severity: string,
  scopeKind: string,
  scopeId: string,
  data: Record<string, unknown>
): Promise<void> {
  const subs = await db
    .select()
    .from(eventSubscription)
    .where(
      and(
        eq(eventSubscription.kind, "trigger"),
        eq(eventSubscription.status, "active"),
        gt(eventSubscription.expiresAt, new Date())
      )
    )

  const matched = subs.filter((sub) => {
    // Topic filter
    if (!matchTopic(sub.topicFilter, topic)) return false

    // Severity filter
    if (sub.minSeverity) {
      const order: Record<string, number> = {
        debug: 0,
        info: 1,
        warning: 2,
        critical: 3,
      }
      if ((order[severity] ?? 0) < (order[sub.minSeverity] ?? 0)) return false
    }

    // Scope filter
    if (sub.scopeKind && sub.scopeId) {
      if (scopeKind !== sub.scopeKind || scopeId !== sub.scopeId) return false
    }

    // JSONB containment
    if (sub.matchFields) {
      const fields = sub.matchFields as Record<string, unknown>
      for (const [key, value] of Object.entries(fields)) {
        if (data[key] !== value) return false
      }
    }

    return true
  })

  logger.info(
    { topic, triggerMatches: matched.length },
    "matchSubscriptions: matched triggers"
  )

  for (const sub of matched) {
    await send(sub.ownerId, data, topic)
    await db
      .update(eventSubscription)
      .set({ status: "fired" })
      .where(eq(eventSubscription.id, sub.id))
    logger.info(
      { topic, workflowRunId: sub.ownerId },
      "matchSubscriptions: woke workflow"
    )
  }
}
