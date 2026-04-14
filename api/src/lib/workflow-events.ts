/**
 * Event Matching Layer
 *
 * Inngest-style content-based routing on top of Workflow SDK webhooks.
 *
 * Workflows call:   waitForEvent("workbench.ready", { workbenchId: "wb-123" }, 600)
 * External code:    emitEvent(db, "workbench.ready", { workbenchId: "wb-123", status: "active" })
 *
 * Matching uses Postgres JSONB containment (<@): the subscription's matchFields
 * must be a subset of the emitted event data. This is GIN-indexable.
 *
 * Under the hood, waitForEvent creates a Workflow SDK webhook and stores its URL
 * in the event_subscription table. emitEvent finds matching subscriptions and
 * POSTs to their webhook URLs to resume the suspended workflow.
 */
import { and, eq, gt, sql } from "drizzle-orm"

import type { Database } from "../db/connection"
import { eventSubscription } from "../db/schema/org"
const log = (data: Record<string, unknown>, msg: string) =>
  console.log(JSON.stringify({ ...data, msg }))
import { newId } from "./id"
import { createWebhook, sleep } from "./workflow-engine"
import { getWorkflowDb } from "./workflow-helpers"

// ── waitForEvent (workflow side) ──────────────────────────

/**
 * Suspend the current workflow until a matching event arrives.
 *
 * Creates a Workflow SDK webhook, registers its URL in the
 * event_subscription table, then races the webhook against a timeout.
 * When emitEvent() POSTs to the webhook URL, the workflow resumes.
 *
 * @param eventName  - Event name to wait for (e.g. "workbench.ready")
 * @param match      - Fields to match against emitted event data
 * @param timeoutSec - Max seconds to wait before returning null
 */
export async function waitForEvent<T>(
  eventName: string,
  match: Record<string, string>,
  timeoutSec: number
): Promise<T | null> {
  const db = getWorkflowDb()
  const webhook = await createWebhook()

  log(
    { eventName, match, timeoutSec },
    `waitForEvent: subscribing to ${eventName}`
  )

  const subId = newId("esub")

  // Register subscription with webhook URL as the owner
  await db.insert(eventSubscription).values({
    id: subId,
    kind: "trigger",
    status: "active",
    topicFilter: eventName,
    matchFields: match,
    ownerKind: "webhook",
    ownerId: webhook.url,
    expiresAt: new Date(Date.now() + timeoutSec * 1000),
  })

  // Race: webhook resolves when emitEvent POSTs, or timeout
  const result = await Promise.race([
    (webhook as any).then((data: unknown) => data as T),
    sleep(timeoutSec * 1000).then(() => null),
  ])

  // Clean up subscription (best-effort)
  await db
    .delete(eventSubscription)
    .where(eq(eventSubscription.id, subId))
    .catch(() => {})

  return result
}

// ── emitEvent (external side) ─────────────────────────────

/**
 * Emit an event. Finds all matching subscriptions and POSTs to their
 * webhook URLs to wake the corresponding workflows.
 *
 * Called from outside workflows (reconcilers, webhook handlers),
 * so requires an explicit db parameter.
 *
 * Matching uses Postgres JSONB containment: subscription.matchFields <@ data.
 *
 * @param db        - Database connection
 * @param eventName - Event name (e.g. "workbench.ready")
 * @param data      - Event payload
 */
export async function emitEvent(
  db: Database,
  eventName: string,
  data: Record<string, unknown>
) {
  // Find non-expired, active trigger subscriptions where matchFields ⊆ data
  const subs = await db
    .select()
    .from(eventSubscription)
    .where(
      and(
        eq(eventSubscription.topicFilter, eventName),
        eq(eventSubscription.kind, "trigger"),
        eq(eventSubscription.status, "active"),
        sql`COALESCE(${eventSubscription.matchFields}, '{}') <@ ${JSON.stringify(data)}::jsonb`,
        gt(eventSubscription.expiresAt, new Date())
      )
    )

  log(
    { eventName, matchCount: subs.length },
    `emitEvent: ${eventName} (${subs.length} match${subs.length === 1 ? "" : "es"})`
  )

  // POST to each matching webhook URL
  for (const sub of subs) {
    try {
      log(
        { eventName, webhookUrl: sub.ownerId },
        "emitEvent: posting to webhook"
      )
      await fetch(sub.ownerId, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })

      // Mark trigger as fired
      await db
        .update(eventSubscription)
        .set({ status: "fired" })
        .where(eq(eventSubscription.id, sub.id))
    } catch (err) {
      log(
        { eventName, webhookUrl: sub.ownerId, error: String(err) },
        "emitEvent: webhook POST failed"
      )
    }
  }
}

// ── Cleanup ───────────────────────────────────────────────

/**
 * Remove expired subscriptions. Call periodically (e.g. every 5 minutes).
 */
export async function cleanupExpiredSubscriptions(db: Database) {
  const { lt } = await import("drizzle-orm")
  await db
    .delete(eventSubscription)
    .where(
      and(
        eq(eventSubscription.kind, "trigger"),
        lt(eventSubscription.expiresAt, new Date())
      )
    )
}
