import { Elysia, t } from "elysia"

import type { Database } from "../../db/connection"
import { emitExternalEvent } from "../../lib/events"
import {
  recordWebhookEvent,
  updateWebhookEventStatus,
} from "../../lib/webhook-events"
import { logger } from "../../logger"
import { bot } from "../chat/index"

const wlog = logger.child({ module: "webhook" })

/**
 * Map Slack event type to normalized event type.
 */
function normalizeSlackEventType(eventType: string): string {
  switch (eventType) {
    case "message":
      return "chat.message"
    case "app_mention":
      return "chat.mention"
    case "reaction_added":
      return "chat.reaction.added"
    case "reaction_removed":
      return "chat.reaction.removed"
    case "url_verification":
      return "system.ping"
    default:
      return `chat.${eventType}`
  }
}

export function messagingWebhookController(db: Database) {
  return new Elysia({ prefix: "/webhooks" }).post(
    "/messaging/:providerId",
    async ({ params, request }) => {
      // Read the raw body for Slack signature verification.
      // With parse: 'none', Elysia skips body parsing so we can read
      // the original bytes. The Chat SDK needs exact bytes for HMAC verification.
      const rawBody = await request.text()
      const slackPayload = JSON.parse(rawBody)
      const slackEventType =
        (slackPayload as any)?.event?.type ??
        (slackPayload as any)?.type ??
        "unknown"
      const slackUserId = (slackPayload as any)?.event?.user as
        | string
        | undefined
      const slackChannelId = (slackPayload as any)?.event?.channel as
        | string
        | undefined
      const slackDeliveryId =
        (slackPayload as any)?.event_id ??
        (slackPayload as any)?.event?.event_ts ??
        crypto.randomUUID()

      wlog.info(
        {
          source: "slack",
          providerId: params.providerId,
          event: slackEventType,
          channel: slackChannelId,
          user: slackUserId,
        },
        `slack ${slackEventType}${slackChannelId ? ` in ${slackChannelId}` : ""}${slackUserId ? ` from ${slackUserId}` : ""}`
      )

      // 1. Record webhook event (keep existing behavior)
      const slackDeliveryIdStr = String(slackDeliveryId)
      const eventId = await recordWebhookEvent(db, {
        source: "slack",
        providerId: params.providerId,
        deliveryId: slackDeliveryIdStr,
        eventType: slackEventType,
        normalizedEventType: normalizeSlackEventType(slackEventType),
        payload: slackPayload,
        actor: slackUserId ? { externalId: slackUserId } : undefined,
        entity: slackChannelId
          ? { externalRef: slackChannelId, kind: "channel" }
          : undefined,
      })

      // Emit canonical event (fire-and-forget)
      emitExternalEvent(db, {
        source: "slack",
        eventType: slackEventType,
        payload: slackPayload as Record<string, unknown>,
        providerId: params.providerId,
        deliveryId: slackDeliveryIdStr,
        actorExternalId: slackUserId,
      }).catch((err) => {
        wlog.warn(
          { event: slackEventType, deliveryId: slackDeliveryIdStr, err },
          "failed to emit external event for slack webhook"
        )
      })

      // 2. Forward to Chat SDK (handles verification, challenges, event routing)
      const chatRequest = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: rawBody,
      })

      let response: Response
      try {
        response = await bot.webhooks.slack(chatRequest, {
          waitUntil: (task) => {
            task.catch((err) =>
              wlog.error({ err }, "Chat SDK background task failed")
            )
          },
        })
      } catch (err) {
        if (eventId)
          await updateWebhookEventStatus(db, eventId, { status: "failed" })
        wlog.error({ err, eventId }, "Chat SDK webhook processing failed")
        return new Response("internal error", { status: 500 })
      }

      // 3. Update webhook event status
      if (eventId)
        await updateWebhookEventStatus(db, eventId, { status: "processed" })

      return response
    },
    {
      params: t.Object({ providerId: t.String() }),
      parse: "none" as const,
      detail: {
        tags: ["Webhooks"],
        summary: "Receive Slack webhook (Chat SDK)",
        security: [],
      },
    }
  )
}
