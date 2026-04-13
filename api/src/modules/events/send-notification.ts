import type {
  EventSeverity,
  SendNotificationInput,
} from "@smp/factory-shared/schemas/events"

import type { Database } from "../../db/connection"
import { eventDelivery } from "../../db/schema/org"
import { emitEvent } from "../../lib/events"
import { logger } from "../../logger"
import { getDeliveryAdapter, providerToRenderFormat } from "./delivery-adapter"
import { renderEvent } from "./event-renderers"
import { resolveDeliveryTarget } from "./identity-resolver"
import { resolveRecipients } from "./recipient-resolver"

const log = logger.child({ module: "send-notification" })

export interface NotificationResult {
  eventId: string | null
  delivered: number
  failed: number
  recipients: Array<{
    principalId: string
    channels: Array<{ provider: string; status: string; error?: string }>
  }>
}

export function buildNotificationEvent(input: {
  to: string
  title: string
  body?: string
  topic?: string
  severity?: EventSeverity
  source?: string
  data?: Record<string, unknown>
  correlationId?: string
}) {
  const topicSuffix = input.topic ?? "alert"
  return {
    topic: `notification.${topicSuffix}`,
    source: input.source ?? "api",
    severity: input.severity ?? "info",
    data: {
      title: input.title,
      ...(input.body ? { body: input.body } : {}),
      recipient: input.to,
      ...input.data,
    },
    correlationId: input.correlationId,
  }
}

export async function sendNotification(
  db: Database,
  input: SendNotificationInput
): Promise<NotificationResult> {
  // 1. Emit notification event for audit trail
  const notifEvent = buildNotificationEvent(input)
  const eventId = await emitEvent(db, {
    ...notifEvent,
    scopeKind: "org",
    scopeId: "default",
    schemaVersion: 1,
  })

  const now = new Date().toISOString()

  // 2. Resolve recipients
  const recipients = await resolveRecipients(db, input.to, input.channels)

  if (recipients.length === 0) {
    log.warn({ to: input.to }, "sendNotification: no recipients resolved")
    return { eventId, delivered: 0, failed: 0, recipients: [] }
  }

  // 3. Deliver to each recipient's channels
  let totalDelivered = 0
  let totalFailed = 0
  const recipientResults: NotificationResult["recipients"] = []

  for (const recipient of recipients) {
    const channelResults: Array<{
      provider: string
      status: string
      error?: string
    }> = []

    for (const provider of recipient.channels) {
      // Resolve identity for this provider
      const resolved = await resolveDeliveryTarget(
        db,
        { provider, target: "@owner" },
        recipient.principalId
      )

      if (!resolved) {
        channelResults.push({
          provider,
          status: "skipped",
          error: "no identity link",
        })
        continue
      }

      // Render for this channel type
      const renderFormat = providerToRenderFormat(provider)
      const rendered = renderEvent(
        {
          id: eventId ?? "evt_unknown",
          topic: notifEvent.topic,
          source: notifEvent.source,
          severity: notifEvent.severity,
          scopeKind: "org",
          scopeId: "default",
          spec: { data: notifEvent.data },
          schemaVersion: 1,
          occurredAt: now,
          createdAt: now,
        },
        renderFormat
      )

      // Deliver
      const adapter = getDeliveryAdapter(provider)
      if (!adapter) {
        channelResults.push({
          provider,
          status: "skipped",
          error: "no adapter registered",
        })
        continue
      }

      const result = await adapter.deliver(resolved.target, rendered, {
        eventId: eventId ?? "evt_unknown",
        topic: notifEvent.topic,
        severity: notifEvent.severity,
        source: notifEvent.source,
        occurredAt: now,
      })

      if (result.ok) {
        totalDelivered++
        channelResults.push({ provider, status: "delivered" })
      } else {
        totalFailed++
        channelResults.push({
          provider,
          status: "failed",
          error: result.error,
        })
      }

      // Record delivery in event_delivery table
      if (eventId) {
        await db.insert(eventDelivery).values({
          eventId,
          subscriptionChannelId: `direct:${provider}:${recipient.principalId}`,
          status: result.ok ? "delivered" : "failed",
          deliveredAt: result.ok ? new Date() : null,
          spec: {
            renderOutput: rendered,
            directNotification: true,
            recipientPrincipalId: recipient.principalId,
            ...(result.error ? { error: result.error } : {}),
          },
        })
      }
    }

    recipientResults.push({
      principalId: recipient.principalId,
      channels: channelResults,
    })
  }

  log.info(
    {
      to: input.to,
      eventId,
      recipientCount: recipients.length,
      delivered: totalDelivered,
      failed: totalFailed,
    },
    "sendNotification: complete"
  )

  return {
    eventId,
    delivered: totalDelivered,
    failed: totalFailed,
    recipients: recipientResults,
  }
}
