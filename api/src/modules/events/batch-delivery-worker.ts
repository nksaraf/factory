import { and, eq, inArray } from "drizzle-orm"

import type { Database } from "../../db/connection"
import {
  event,
  eventDelivery,
  eventSubscriptionChannel,
} from "../../db/schema/org"
import { logger } from "../../logger"
import { renderEvent } from "./event-renderers"

export function startBatchDeliveryWorker(
  db: Database,
  intervalMs = 60_000
): { stop: () => void } {
  const timer = setInterval(() => processBatchDeliveries(db), intervalMs)
  logger.info("batch-delivery-worker: started")
  return {
    stop: () => {
      clearInterval(timer)
      logger.info("batch-delivery-worker: stopped")
    },
  }
}

async function processBatchDeliveries(db: Database): Promise<void> {
  try {
    // Find channels with batch/digest delivery that have buffered items
    const channels = await db
      .select()
      .from(eventSubscriptionChannel)
      .where(inArray(eventSubscriptionChannel.delivery, ["batch", "digest"]))

    for (const ch of channels) {
      const spec = (ch.spec ?? {}) as {
        batchWindow?: string
        schedule?: string
      }

      // Parse batch window (e.g., "5m", "1h", "30m")
      const windowMs = parseDuration(spec.batchWindow ?? "5m")
      const lastDelivered = ch.lastDeliveredAt ?? new Date(0)
      const elapsed = Date.now() - lastDelivered.getTime()

      if (elapsed < windowMs) continue

      // Find all buffered deliveries for this channel
      const buffered = await db
        .select()
        .from(eventDelivery)
        .where(
          and(
            eq(eventDelivery.subscriptionChannelId, ch.id),
            eq(eventDelivery.status, "buffered")
          )
        )

      if (buffered.length === 0) continue

      // Fetch the event rows for rendering
      const eventIds = buffered.map((d) => d.eventId)
      const events = await db
        .select()
        .from(event)
        .where(inArray(event.id, eventIds))

      // Render each event
      const channelType = ch.channelId.split(":")[0] as
        | "cli"
        | "web"
        | "slack"
        | "email"
      const rendered = events.map((e) =>
        renderEvent(
          {
            ...e,
            occurredAt:
              e.occurredAt instanceof Date
                ? e.occurredAt.toISOString()
                : String(e.occurredAt),
            createdAt:
              e.createdAt instanceof Date
                ? e.createdAt.toISOString()
                : String(e.createdAt),
          },
          channelType
        )
      )

      // Mark all buffered deliveries as delivered
      const deliveryIds = buffered.map((d) => d.id)
      await db
        .update(eventDelivery)
        .set({
          status: "delivered",
          deliveredAt: new Date(),
          spec: { renderOutput: rendered },
        })
        .where(inArray(eventDelivery.id, deliveryIds))

      // Update lastDeliveredAt on the channel
      await db
        .update(eventSubscriptionChannel)
        .set({ lastDeliveredAt: new Date() })
        .where(eq(eventSubscriptionChannel.id, ch.id))

      logger.info(
        {
          channelId: ch.id,
          delivery: ch.delivery,
          eventCount: buffered.length,
        },
        "batch-delivery-worker: delivered batch"
      )
    }
  } catch (err) {
    logger.error({ err }, "batch-delivery-worker: error")
  }
}

function parseDuration(d: string): number {
  const match = d.match(/^(\d+)(ms|s|m|h|d)$/)
  if (!match) return 5 * 60_000 // default 5m
  const val = parseInt(match[1], 10)
  switch (match[2]) {
    case "ms":
      return val
    case "s":
      return val * 1000
    case "m":
      return val * 60_000
    case "h":
      return val * 3_600_000
    case "d":
      return val * 86_400_000
    default:
      return 5 * 60_000
  }
}
