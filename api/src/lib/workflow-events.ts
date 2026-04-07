/**
 * Event Matching Layer
 *
 * Inngest-style content-based routing on top of DBOS send/recv.
 *
 * Workflows call:   waitForEvent("workspace.ready", { workspaceId: "ws-123" }, 600)
 * External code:    emitEvent(db, "workspace.ready", { workspaceId: "ws-123", status: "active" })
 *
 * Matching uses Postgres JSONB containment (<@): the subscription's matchFields
 * must be a subset of the emitted event data. This is GIN-indexable.
 */

import { and, eq, gt, lt, sql } from "drizzle-orm";

import type { Database } from "../db/connection";
import { eventSubscription } from "../db/schema/org-v2";
import { newId } from "./id";
import { getWorkflowId, recv, send } from "./workflow-engine";
import { getWorkflowDb } from "./workflow-helpers";
import { logger } from "../logger";

// ── waitForEvent (workflow side) ──────────────────────────

/**
 * Suspend the current workflow until a matching event arrives.
 *
 * Registers a subscription in the event_subscription table, then
 * calls DBOS recv() to durably suspend. On match, emitEvent() calls
 * send() which wakes the workflow.
 *
 * Uses getWorkflowDb() internally — no db parameter needed.
 *
 * @param eventName  - Event name to wait for (e.g. "workspace.ready")
 * @param match      - Fields to match against emitted event data
 * @param timeoutSec - Max seconds to wait before returning null
 */
export async function waitForEvent<T>(
  eventName: string,
  match: Record<string, string>,
  timeoutSec: number,
): Promise<T | null> {
  const db = getWorkflowDb();
  const wfId = getWorkflowId();

  logger.info({ eventName, match, workflowRunId: wfId, timeoutSec }, `waitForEvent: subscribing to ${eventName}`);

  // Register subscription
  await db.insert(eventSubscription).values({
    id: newId("esub"),
    workflowRunId: wfId,
    eventName,
    matchFields: match,
    expiresAt: new Date(Date.now() + timeoutSec * 1000),
  });

  // Durable suspend — zero CPU, survives crashes
  const result = await recv<T>(eventName, timeoutSec);

  // Clean up subscription (best-effort, may already be gone on timeout)
  await db
    .delete(eventSubscription)
    .where(
      and(
        eq(eventSubscription.workflowRunId, wfId),
        eq(eventSubscription.eventName, eventName),
      ),
    )
    .catch(() => {});

  return result;
}

// ── emitEvent (external side) ─────────────────────────────

/**
 * Emit an event. Finds all matching subscriptions and wakes the
 * corresponding workflows via send().
 *
 * Called from outside workflows (reconcilers, webhook handlers),
 * so requires an explicit db parameter.
 *
 * Matching uses Postgres JSONB containment: subscription.matchFields <@ data.
 * So { workspaceId: "ws-123" } matches { workspaceId: "ws-123", status: "active", cpu: 4 }.
 *
 * @param db        - Database connection
 * @param eventName - Event name (e.g. "workspace.ready")
 * @param data      - Event payload — must contain all fields that subscriptions match on
 */
export async function emitEvent(
  db: Database,
  eventName: string,
  data: Record<string, unknown>,
) {
  // Find non-expired subscriptions where matchFields ⊆ data
  const subs = await db
    .select()
    .from(eventSubscription)
    .where(
      and(
        eq(eventSubscription.eventName, eventName),
        sql`${eventSubscription.matchFields} <@ ${JSON.stringify(data)}::jsonb`,
        gt(eventSubscription.expiresAt, new Date()),
      ),
    );

  logger.info({ eventName, matchCount: subs.length }, `emitEvent: ${eventName} (${subs.length} match${subs.length === 1 ? "" : "es"})`);

  // Wake each matching workflow
  for (const sub of subs) {
    logger.info({ eventName, workflowRunId: sub.workflowRunId }, "emitEvent: waking workflow");
    await send(sub.workflowRunId, data, eventName);
  }
}

// ── Cleanup ───────────────────────────────────────────────

/**
 * Remove expired subscriptions. Call periodically (e.g. every 5 minutes)
 * from a background task or cron.
 */
export async function cleanupExpiredSubscriptions(db: Database) {
  await db
    .delete(eventSubscription)
    .where(lt(eventSubscription.expiresAt, new Date()));
}
