import { and, eq } from "drizzle-orm"

import type { Database } from "../../db/connection"
import {
  eventDelivery,
  eventAlert,
  eventSubscription,
  eventSubscriptionChannel,
} from "../../db/schema/org"
import { logger } from "../../logger"
import { getDeliveryAdapter, providerToRenderFormat } from "./delivery-adapter"
import { renderEvent } from "./event-renderers"
import { parseChannelAddress, resolveDeliveryTarget } from "./identity-resolver"
import { severityGte } from "./scope-resolver"
import { StormDetector } from "./storm-detector"
import { matchTopic } from "./topic-matcher"

// ── Pure matching functions (exported for testing) ────────────

interface SubscriptionLike {
  kind: string
  status: string
  topicFilter: string
  minSeverity: string | null
  scopeKind: string | null
  scopeId: string | null
  matchFields: Record<string, unknown> | null
  spec: Record<string, unknown> | null
  expiresAt: Date | null
}

interface EventLike {
  topic: string
  severity: string
  scopeKind: string
  scopeId: string
  data: Record<string, unknown>
}

export function matchStreamSubscription(
  sub: SubscriptionLike,
  event: EventLike
): boolean {
  if (sub.kind !== "stream" || sub.status !== "active") return false
  if (sub.expiresAt && sub.expiresAt < new Date()) return false
  if (!matchTopic(sub.topicFilter, event.topic)) return false
  if (sub.minSeverity && !severityGte(event.severity, sub.minSeverity))
    return false
  if (sub.scopeKind && sub.scopeId) {
    if (event.scopeKind !== sub.scopeKind || event.scopeId !== sub.scopeId)
      return false
  }
  if (sub.matchFields) {
    for (const [key, value] of Object.entries(sub.matchFields)) {
      if (event.data[key] !== value) return false
    }
  }
  return true
}

export function isMuted(
  spec: Record<string, unknown> | null | undefined
): boolean {
  if (!spec) return false
  if (spec.muted === true) return true
  if (spec.mutedUntil) {
    return new Date(spec.mutedUntil as string) > new Date()
  }
  return false
}

export function isQuietHours(
  start: string | undefined,
  end: string | undefined,
  currentHour: number
): boolean {
  if (!start || !end) return false
  const s = parseInt(start.split(":")[0], 10)
  const e = parseInt(end.split(":")[0], 10)
  if (s < e) {
    return currentHour >= s && currentHour < e
  }
  // Overnight range (e.g., 22:00-06:00)
  return currentHour >= s || currentHour < e
}

// ── Notification Router class ─────────────────────────────────

export class NotificationRouter {
  private db: Database
  private storm: StormDetector

  constructor(
    db: Database,
    stormConfig = { thresholdPerMinute: 100, windowMs: 60_000 }
  ) {
    this.db = db
    this.storm = new StormDetector(stormConfig)
  }

  destroy(): void {
    this.storm.destroy()
  }

  async processEvent(eventRow: {
    id: string
    topic: string
    source: string
    severity: string
    scopeKind: string
    scopeId: string
    spec: { data?: Record<string, unknown>; rawPayload?: unknown }
    schemaVersion: number
    occurredAt: Date | string
    createdAt: Date | string
  }): Promise<{ delivered: number; buffered: number; stormed: boolean }> {
    const topicPrefix = eventRow.topic.split(".").slice(0, 2).join(".")
    const isStorm = this.storm.record(topicPrefix, eventRow.scopeId)

    if (isStorm) {
      logger.warn(
        { topic: eventRow.topic, eventId: eventRow.id },
        "notification-router: storm mode, skipping individual delivery"
      )
      return { delivered: 0, buffered: 0, stormed: true }
    }

    const eventData: EventLike = {
      topic: eventRow.topic,
      severity: eventRow.severity,
      scopeKind: eventRow.scopeKind,
      scopeId: eventRow.scopeId,
      data: (eventRow.spec.data ?? {}) as Record<string, unknown>,
    }

    // Query all active stream subscriptions
    const subs = await this.db
      .select()
      .from(eventSubscription)
      .where(
        and(
          eq(eventSubscription.kind, "stream"),
          eq(eventSubscription.status, "active")
        )
      )

    const matched = subs.filter((sub) =>
      matchStreamSubscription(
        {
          kind: sub.kind,
          status: sub.status,
          topicFilter: sub.topicFilter,
          minSeverity: sub.minSeverity,
          scopeKind: sub.scopeKind,
          scopeId: sub.scopeId,
          matchFields: sub.matchFields as Record<string, unknown> | null,
          spec: sub.spec as Record<string, unknown> | null,
          expiresAt: sub.expiresAt,
        },
        eventData
      )
    )

    let delivered = 0
    let buffered = 0

    for (const sub of matched) {
      const subSpec = (sub.spec ?? {}) as Record<string, unknown>
      if (isMuted(subSpec)) continue

      // Check quiet hours
      const quietStart = subSpec.quietHoursStart as string | undefined
      const quietEnd = subSpec.quietHoursEnd as string | undefined
      if (isQuietHours(quietStart, quietEnd, new Date().getHours())) continue

      // Get channels for this subscription
      const channels = await this.db
        .select()
        .from(eventSubscriptionChannel)
        .where(eq(eventSubscriptionChannel.subscriptionId, sub.id))

      for (const ch of channels) {
        // Per-channel severity filter
        if (ch.minSeverity && !severityGte(eventRow.severity, ch.minSeverity)) {
          continue
        }

        if (ch.delivery === "realtime") {
          const address = parseChannelAddress(ch.channelId)
          if (!address) {
            logger.warn(
              { channelId: ch.channelId },
              "notification-router: invalid channel address"
            )
            continue
          }

          const resolved = await resolveDeliveryTarget(
            this.db,
            address,
            sub.ownerId
          )
          if (!resolved) {
            logger.debug(
              { channelId: ch.channelId, ownerId: sub.ownerId },
              "notification-router: could not resolve delivery target"
            )
            continue
          }

          const renderFormat = providerToRenderFormat(resolved.provider)
          const renderOutput = renderEvent(
            {
              ...eventRow,
              occurredAt:
                typeof eventRow.occurredAt === "string"
                  ? eventRow.occurredAt
                  : eventRow.occurredAt.toISOString(),
              createdAt:
                typeof eventRow.createdAt === "string"
                  ? eventRow.createdAt
                  : eventRow.createdAt.toISOString(),
            },
            renderFormat
          )

          const adapter = getDeliveryAdapter(resolved.provider)
          let deliveryStatus = "delivered"
          let deliveryError: string | undefined

          if (adapter) {
            const result = await adapter.deliver(
              resolved.target,
              renderOutput,
              {
                eventId: eventRow.id,
                topic: eventRow.topic,
                severity: eventRow.severity,
                source: eventRow.source,
                occurredAt:
                  typeof eventRow.occurredAt === "string"
                    ? eventRow.occurredAt
                    : eventRow.occurredAt.toISOString(),
              }
            )
            if (!result.ok) {
              deliveryStatus = "failed"
              deliveryError = result.error
            }
          }

          await this.db.insert(eventDelivery).values({
            eventId: eventRow.id,
            subscriptionChannelId: ch.id,
            status: deliveryStatus,
            deliveredAt: deliveryStatus === "delivered" ? new Date() : null,
            spec: {
              renderOutput,
              ...(deliveryError ? { error: deliveryError } : {}),
            },
          })
          if (deliveryStatus === "delivered") delivered++
        } else {
          // batch or digest — buffer for later delivery
          await this.db.insert(eventDelivery).values({
            eventId: eventRow.id,
            subscriptionChannelId: ch.id,
            status: "buffered",
          })
          buffered++
        }
      }

      // Create alert if subscription has escalation policy and severity >= warning
      const escalationPolicy = subSpec.escalationPolicy as unknown
      if (escalationPolicy && severityGte(eventRow.severity, "warning")) {
        const policy = escalationPolicy as {
          steps: Array<{ delayMinutes: number }>
        }
        const firstDelay = policy.steps?.[0]?.delayMinutes ?? 15
        await this.db.insert(eventAlert).values({
          eventId: eventRow.id,
          subscriptionId: sub.id,
          severity: eventRow.severity,
          status: "firing",
          escalationStep: 0,
          nextEscalation: new Date(Date.now() + firstDelay * 60_000),
          spec: { escalationPolicy },
        })
      }
    }

    logger.info(
      {
        eventId: eventRow.id,
        topic: eventRow.topic,
        matchedSubs: matched.length,
        delivered,
        buffered,
      },
      "notification-router: processed event"
    )

    return { delivered, buffered, stormed: false }
  }
}
