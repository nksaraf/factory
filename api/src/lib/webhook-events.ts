/**
 * Universal webhook event recording — stores every inbound webhook
 * in org.webhook_event regardless of processing outcome.
 */

import { and, eq } from "drizzle-orm";
import type { Database } from "../db/connection";
import { webhookEvent } from "../db/schema/org-v2";
import type { WebhookEventSpec } from "@smp/factory-shared/schemas/org";

export type RecordWebhookEventInput = {
  source: string;
  providerId: string;
  deliveryId: string;
  eventType: string;
  action?: string;
  payload?: unknown;
};

/**
 * Insert a webhook event record. Returns the row ID, or null if it's a duplicate.
 */
export async function recordWebhookEvent(
  db: Database,
  input: RecordWebhookEventInput,
): Promise<string | null> {
  // Dedup by (source, providerId, deliveryId)
  const [existing] = await db
    .select({ id: webhookEvent.id })
    .from(webhookEvent)
    .where(
      and(
        eq(webhookEvent.source, input.source),
        eq(webhookEvent.providerId, input.providerId),
        eq(webhookEvent.deliveryId, input.deliveryId),
      ),
    )
    .limit(1);

  if (existing) return null;

  const [row] = await db
    .insert(webhookEvent)
    .values({
      source: input.source,
      providerId: input.providerId,
      deliveryId: input.deliveryId,
      spec: {
        eventType: input.eventType,
        action: input.action,
        payload: input.payload,
        status: "received",
      } as WebhookEventSpec,
    })
    .returning();

  return row.id;
}

/**
 * Update a webhook event's status after processing.
 */
export async function updateWebhookEventStatus(
  db: Database,
  eventId: string,
  update: { status: "processing" | "processed" | "ignored" | "failed"; reason?: string; error?: string },
): Promise<void> {
  const [row] = await db
    .select()
    .from(webhookEvent)
    .where(eq(webhookEvent.id, eventId))
    .limit(1);

  if (!row) return;

  const spec = row.spec as WebhookEventSpec;
  await db
    .update(webhookEvent)
    .set({
      spec: {
        ...spec,
        status: update.status,
        reason: update.reason ?? spec.reason,
        error: update.error ?? spec.error,
        processedAt: update.status !== "processing" ? new Date() : spec.processedAt,
      } as WebhookEventSpec,
    })
    .where(eq(webhookEvent.id, eventId));
}
