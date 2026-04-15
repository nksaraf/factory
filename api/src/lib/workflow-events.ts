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
 * in the event_subscription table. matchAndNotifySubscriptions finds matching
 * subscriptions and POSTs to their webhook URLs to resume suspended workflows.
 */
import { and, eq, gt, sql } from "drizzle-orm"

import type { Database } from "../db/connection"
import { eventSubscription } from "../db/schema/org"
import { logger } from "../logger"
import { matchTopic } from "../modules/events/topic-matcher"
import { newId } from "./id"
import { createWebhook, sleep } from "./workflow-engine"
import { getWorkflowDb } from "./workflow-helpers"

// ── waitForEvent (workflow side) ──────────────────────────

/**
 * Suspend the current workflow until a matching event arrives.
 *
 * Creates a Workflow SDK webhook, registers its URL in the
 * event_subscription table, then races the webhook against a timeout.
 * When matchAndNotifySubscriptions() POSTs to the webhook URL, the workflow resumes.
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

  logger.info(
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

// ── Severity ordering ────────────────────────────────────

const SEVERITY_ORDER: Record<string, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  critical: 3,
}

// ── matchAndNotifySubscriptions (shared) ─────────────────

export interface MatchSubscriptionsOpts {
  topic: string
  data: Record<string, unknown>
  severity?: string
  scopeKind?: string
  scopeId?: string
}

/**
 * Match an event against all active trigger subscriptions and POST
 * to their webhook URLs to wake the corresponding workflows.
 *
 * This is the single matching path — called by both:
 * - the canonical emitEvent (events.ts) after writing to org.event
 * - the REST /workflow/events endpoint for manual testing
 *
 * Matching supports topic globs, severity filtering, scope filtering,
 * and JSONB containment for matchFields.
 */
export async function matchAndNotifySubscriptions(
  db: Database,
  opts: MatchSubscriptionsOpts
): Promise<void> {
  const { topic, data, severity = "info", scopeKind, scopeId } = opts

  // Pull all active trigger subs that haven't expired.
  // We filter topic/severity/scope/fields in JS to support glob matching.
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
    if (!matchTopic(sub.topicFilter, topic)) return false

    if (sub.minSeverity) {
      if (
        (SEVERITY_ORDER[severity] ?? 0) < (SEVERITY_ORDER[sub.minSeverity] ?? 0)
      )
        return false
    }

    if (sub.scopeKind && sub.scopeId) {
      if (scopeKind !== sub.scopeKind || scopeId !== sub.scopeId) return false
    }

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
    try {
      await fetch(sub.ownerId, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      await db
        .update(eventSubscription)
        .set({ status: "fired" })
        .where(eq(eventSubscription.id, sub.id))
      logger.info(
        { topic, webhookUrl: sub.ownerId },
        "matchSubscriptions: woke workflow"
      )
    } catch (err) {
      logger.warn(
        { topic, webhookUrl: sub.ownerId, err },
        "matchSubscriptions: webhook POST failed"
      )
    }
  }
}

// ── emitEvent (simple path for REST /workflow/events) ────

/**
 * Simple event emission — matches subscriptions and POSTs to webhooks.
 * Used by the REST /workflow/events endpoint for manual testing.
 * The canonical path (events.ts emitEvent) writes to org.event first,
 * then calls matchAndNotifySubscriptions directly.
 */
export async function emitEvent(
  db: Database,
  eventName: string,
  data: Record<string, unknown>
) {
  return matchAndNotifySubscriptions(db, { topic: eventName, data })
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
