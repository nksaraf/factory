/**
 * Universal webhook event recording — stores every inbound webhook
 * in org.webhook_event regardless of processing outcome.
 *
 * Normalized columns (actor_id, event_type, entity_id) are denormalized
 * from spec for indexing/query performance.
 */

import { and, eq } from "drizzle-orm"
import type { Database } from "../db/connection"
import { webhookEvent, identityLink } from "../db/schema/org-v2"
import { gitUserSync } from "../db/schema/build-v2"
import type {
  WebhookEventSpec,
  WebhookEventActor,
  WebhookEventEntity,
} from "@smp/factory-shared/schemas/org"
import type { GitUserSyncSpec } from "@smp/factory-shared/schemas/build"

export type RecordWebhookEventInput = {
  source: string
  providerId: string
  deliveryId: string
  eventType: string
  normalizedEventType?: string
  action?: string
  payload?: unknown
  actor?: WebhookEventActor
  entity?: WebhookEventEntity
  actorId?: string | null
  entityId?: string | null
}

/**
 * Resolve an external identity to an internal principal ID.
 * Queries identityLink first, falls back to gitUserSync for GitHub.
 */
export async function resolveActorPrincipal(
  db: Database,
  source: string,
  externalId: string
): Promise<string | null> {
  // Map webhook source to identityLink type
  const linkType =
    source === "github"
      ? "github"
      : source === "slack"
        ? "slack"
        : source === "jira"
          ? "jira"
          : null

  if (!linkType) return null

  // Try identityLink first
  const [link] = await db
    .select({ principalId: identityLink.principalId })
    .from(identityLink)
    .where(
      and(
        eq(identityLink.type, linkType),
        eq(identityLink.externalId, externalId)
      )
    )
    .limit(1)

  if (link) return link.principalId

  // Fallback: for GitHub, check gitUserSync
  if (source === "github") {
    const [sync] = await db
      .select({ spec: gitUserSync.spec })
      .from(gitUserSync)
      .where(eq(gitUserSync.externalUserId, externalId))
      .limit(1)

    const syncSpec = sync?.spec as GitUserSyncSpec | null
    if (syncSpec?.principalId) return syncSpec.principalId
  }

  return null
}

/**
 * Insert a webhook event record. Returns the row ID, or null if it's a duplicate.
 */
export async function recordWebhookEvent(
  db: Database,
  input: RecordWebhookEventInput
): Promise<string | null> {
  // Dedup by (source, providerId, deliveryId)
  const [existing] = await db
    .select({ id: webhookEvent.id })
    .from(webhookEvent)
    .where(
      and(
        eq(webhookEvent.source, input.source),
        eq(webhookEvent.providerId, input.providerId),
        eq(webhookEvent.deliveryId, input.deliveryId)
      )
    )
    .limit(1)

  if (existing) return null

  const [row] = await db
    .insert(webhookEvent)
    .values({
      source: input.source,
      providerId: input.providerId,
      deliveryId: input.deliveryId,
      actorId: input.actorId ?? input.actor?.principalId ?? null,
      eventType: input.normalizedEventType ?? null,
      entityId: input.entityId ?? input.entity?.entityId ?? null,
      spec: {
        eventType: input.eventType,
        action: input.action,
        actor: input.actor,
        entity: input.entity,
        payload: input.payload,
        status: "received",
      } as WebhookEventSpec,
    })
    .returning()

  return row.id
}

/**
 * Update a webhook event's status after processing.
 */
export async function updateWebhookEventStatus(
  db: Database,
  eventId: string,
  update: {
    status: "processing" | "processed" | "ignored" | "failed"
    reason?: string
    error?: string
  }
): Promise<void> {
  const [row] = await db
    .select()
    .from(webhookEvent)
    .where(eq(webhookEvent.id, eventId))
    .limit(1)

  if (!row) return

  const spec = row.spec as WebhookEventSpec
  await db
    .update(webhookEvent)
    .set({
      spec: {
        ...spec,
        status: update.status,
        reason: update.reason ?? spec.reason,
        error: update.error ?? spec.error,
        processedAt:
          update.status !== "processing" ? new Date() : spec.processedAt,
      } as WebhookEventSpec,
    })
    .where(eq(webhookEvent.id, eventId))
}
