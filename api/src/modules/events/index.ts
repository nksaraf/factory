import { and, eq, or } from "drizzle-orm"
import { Elysia } from "elysia"

import type { Database } from "../../db/connection"
import {
  eventAlert,
  eventSubscription,
  eventSubscriptionChannel,
} from "../../db/schema/org"
import type {
  EventSubscriptionChannelSpec,
  EventSubscriptionSpec,
} from "../../db/schema/org"
import { logger } from "../../logger"
import { startBatchDeliveryWorker } from "./batch-delivery-worker"
import { registerDeliveryAdapter } from "./delivery-adapter"
import { ChatDeliveryAdapter } from "./delivery-adapter-chat"
import { EmailDeliveryAdapter } from "./delivery-adapter-email"
import { WebDeliveryAdapter } from "./delivery-adapter-web"
import { startEscalationWorker } from "./escalation-worker"
import { NotificationRouter } from "./notification-router"
import { sendNotification } from "./send-notification"

export function eventController(db: Database) {
  return (
    new Elysia({ prefix: "/events" })

      // ── Stream subscription CRUD ──

      .post(
        "/subscriptions",
        async ({ body }) => {
          const {
            name,
            topicFilter,
            ownerKind,
            ownerId,
            minSeverity,
            scopeKind,
            scopeId,
            matchFields,
            spec,
          } = body as {
            name?: string
            topicFilter: string
            ownerKind: string
            ownerId: string
            minSeverity?: string
            scopeKind?: string
            scopeId?: string
            matchFields?: Record<string, unknown>
            spec?: Record<string, unknown>
          }

          const [row] = await db
            .insert(eventSubscription)
            .values({
              name: name ?? null,
              kind: "stream",
              status: "active",
              topicFilter,
              ownerKind,
              ownerId,
              minSeverity: minSeverity ?? null,
              scopeKind: scopeKind ?? null,
              scopeId: scopeId ?? null,
              matchFields: matchFields ?? null,
              ...(spec ? { spec: spec as EventSubscriptionSpec } : {}),
            })
            .returning()

          return { data: row }
        },
        {
          detail: { tags: ["Events"], summary: "Create a stream subscription" },
        }
      )

      .get(
        "/subscriptions",
        async ({ query }) => {
          const { ownerKind, ownerId } = query as {
            ownerKind?: string
            ownerId?: string
          }

          const conditions = [eq(eventSubscription.kind, "stream")]
          if (ownerKind)
            conditions.push(eq(eventSubscription.ownerKind, ownerKind))
          if (ownerId) conditions.push(eq(eventSubscription.ownerId, ownerId))

          const rows = await db
            .select()
            .from(eventSubscription)
            .where(and(...conditions))

          return { data: rows }
        },
        {
          detail: { tags: ["Events"], summary: "List stream subscriptions" },
        }
      )

      .delete(
        "/subscriptions/:id",
        async ({ params }) => {
          await db
            .delete(eventSubscription)
            .where(eq(eventSubscription.id, params.id))
          return { ok: true }
        },
        {
          detail: { tags: ["Events"], summary: "Delete a subscription" },
        }
      )

      // ── Subscription channels ──

      .post(
        "/subscriptions/:id/channels",
        async ({ params, body }) => {
          const { channelId, delivery, minSeverity, spec } = body as {
            channelId: string
            delivery: string
            minSeverity?: string
            spec?: Record<string, unknown>
          }

          const [row] = await db
            .insert(eventSubscriptionChannel)
            .values({
              subscriptionId: params.id,
              channelId,
              delivery,
              minSeverity: minSeverity ?? null,
              ...(spec ? { spec: spec as EventSubscriptionChannelSpec } : {}),
            })
            .returning()

          return { data: row }
        },
        {
          detail: {
            tags: ["Events"],
            summary: "Add a channel to a subscription",
          },
        }
      )

      .delete(
        "/subscriptions/:id/channels/:channelId",
        async ({ params }) => {
          await db
            .delete(eventSubscriptionChannel)
            .where(eq(eventSubscriptionChannel.id, params.channelId))
          return { ok: true }
        },
        {
          detail: {
            tags: ["Events"],
            summary: "Remove a channel from a subscription",
          },
        }
      )

      // ── Alerts ──

      .get(
        "/alerts",
        async () => {
          const rows = await db
            .select()
            .from(eventAlert)
            .where(
              or(
                eq(eventAlert.status, "firing"),
                eq(eventAlert.status, "escalated")
              )
            )
          return { data: rows }
        },
        {
          detail: { tags: ["Events"], summary: "List active alerts" },
        }
      )

      .post(
        "/alerts/:id/acknowledge",
        async ({ params, body }) => {
          const { principalId } = (body ?? {}) as { principalId?: string }
          await db
            .update(eventAlert)
            .set({
              status: "acknowledged",
              acknowledgedBy: principalId ?? null,
              acknowledgedAt: new Date(),
            })
            .where(eq(eventAlert.id, params.id))
          return { ok: true }
        },
        {
          detail: { tags: ["Events"], summary: "Acknowledge an alert" },
        }
      )

      .post(
        "/alerts/:id/resolve",
        async ({ params }) => {
          await db
            .update(eventAlert)
            .set({
              status: "resolved",
              resolvedAt: new Date(),
            })
            .where(eq(eventAlert.id, params.id))
          return { ok: true }
        },
        {
          detail: { tags: ["Events"], summary: "Resolve an alert" },
        }
      )

      // ── Direct notifications ──

      .post(
        "/notify",
        async ({ body }) => {
          const input = body as {
            to: string
            title: string
            body?: string
            topic?: string
            severity?: string
            source?: string
            data?: Record<string, unknown>
            channels?: string[]
            correlationId?: string
          }
          const result = await sendNotification(db, {
            to: input.to,
            title: input.title,
            body: input.body,
            topic: input.topic,
            severity: (input.severity as any) ?? "info",
            source: input.source ?? "api",
            data: input.data,
            channels: input.channels,
            correlationId: input.correlationId,
          })
          return { data: result }
        },
        {
          detail: {
            tags: ["Events"],
            summary: "Send a direct notification to a principal or team",
          },
        }
      )
  )
}

export function startEventWorkers(db: Database) {
  // Register delivery adapters
  registerDeliveryAdapter(new ChatDeliveryAdapter("slack"))
  registerDeliveryAdapter(new ChatDeliveryAdapter("teams"))
  registerDeliveryAdapter(new ChatDeliveryAdapter("google-chat"))
  registerDeliveryAdapter(new EmailDeliveryAdapter())
  registerDeliveryAdapter(new WebDeliveryAdapter())

  logger.info(
    { adapters: ["slack", "teams", "google-chat", "email", "web"] },
    "event-workers: delivery adapters registered"
  )

  const escalation = startEscalationWorker(db)
  const batch = startBatchDeliveryWorker(db)
  const router = new NotificationRouter(db)

  logger.info("event-workers: all workers started")

  return {
    router,
    stop: () => {
      escalation.stop()
      batch.stop()
      router.destroy()
      logger.info("event-workers: all workers stopped")
    },
  }
}
