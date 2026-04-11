/**
 * Emit agent lifecycle events as webhook events, matching the
 * same event types and payload structure as Claude Code / Cursor IDE hooks.
 */
import { recordWebhookEvent } from "../../lib/webhook-events"
import { logger } from "../../logger"
import { getChatDb } from "./db"

const log = logger.child({ module: "chat-events" })

export async function emitAgentEvent(
  sessionId: string,
  eventType: string,
  payload: Record<string, unknown>
) {
  const db = getChatDb()
  const timestamp = new Date().toISOString()
  await recordWebhookEvent(db, {
    source: "chat-agent",
    providerId: sessionId,
    deliveryId: `${sessionId}:${Date.now()}:${eventType}:${crypto.randomUUID().slice(0, 8)}`,
    eventType,
    normalizedEventType: eventType,
    payload: {
      sessionId,
      timestamp,
      ...payload,
    },
  }).catch((err) => log.error({ err, eventType }, "Failed to emit agent event"))
}
