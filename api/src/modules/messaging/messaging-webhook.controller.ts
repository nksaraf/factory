import { Elysia, t } from "elysia";
import type { Database } from "../../db/connection";
import { getMessagingAdapter } from "../../adapters/adapter-registry";
import type { MessagingType } from "../../adapters/messaging-adapter";
import type { MessagingProviderSpec } from "@smp/factory-shared/schemas/org";
import {
  getMessagingProvider,
  resolveMessagingUser,
  resolveChannelContext,
  getOrCreateThread,
  appendMessage,
} from "./messaging.service";
import { logger } from "../../logger";
import { recordWebhookEvent, updateWebhookEventStatus, resolveActorPrincipal } from "../../lib/webhook-events";
import type { WebhookEventActor, WebhookEventEntity } from "@smp/factory-shared/schemas/org";

const wlog = logger.child({ module: "webhook" });

/**
 * Map Slack event type to normalized event type.
 */
function normalizeSlackEventType(eventType: string): string {
  switch (eventType) {
    case "message": return "chat.message";
    case "app_mention": return "chat.mention";
    case "reaction_added": return "chat.reaction.added";
    case "reaction_removed": return "chat.reaction.removed";
    case "url_verification": return "system.ping";
    default: return `chat.${eventType}`;
  }
}

export function messagingWebhookController(db: Database) {
  return new Elysia({ prefix: "/webhooks" }).post(
    "/messaging/:providerId",
    async ({ params, headers, body, set }) => {
      // Record every inbound webhook in org.webhook_event
      const slackPayload = typeof body === "string" ? JSON.parse(body) : body;
      const slackDeliveryId = (slackPayload as any)?.event_id ?? (slackPayload as any)?.event?.event_ts ?? crypto.randomUUID();
      const slackEventType = (slackPayload as any)?.event?.type ?? (slackPayload as any)?.type ?? "unknown";

      // Extract actor from Slack payload
      const slackUserId = (slackPayload as any)?.event?.user as string | undefined;
      const slackChannelId = (slackPayload as any)?.event?.channel as string | undefined;

      wlog.info(
        { source: "slack", providerId: params.providerId, event: slackEventType, channel: slackChannelId, user: slackUserId },
        `slack ${slackEventType}${slackChannelId ? ` in ${slackChannelId}` : ""}${slackUserId ? ` from ${slackUserId}` : ""}`,
      );
      let slackActorPrincipalId: string | null = null;
      if (slackUserId) {
        slackActorPrincipalId = await resolveActorPrincipal(db, "slack", slackUserId).catch(() => null);
      }
      const slackActor: WebhookEventActor | undefined = slackUserId ? {
        externalId: slackUserId,
        principalId: slackActorPrincipalId ?? undefined,
      } : undefined;

      // Extract entity (channel)
      const slackEntity: WebhookEventEntity | undefined = slackChannelId ? {
        externalRef: slackChannelId,
        kind: "channel",
      } : undefined;

      const normalizedEventType = normalizeSlackEventType(slackEventType);

      const eventId = await recordWebhookEvent(db, {
        source: "slack",
        providerId: params.providerId,
        deliveryId: String(slackDeliveryId),
        eventType: slackEventType,
        normalizedEventType,
        payload: slackPayload,
        actor: slackActor,
        entity: slackEntity,
        actorId: slackActorPrincipalId,
      });

      const provider = await getMessagingProvider(db, params.providerId);
      if (!provider) {
        wlog.warn({ source: "slack", providerId: params.providerId }, "webhook provider not found");
        if (eventId) await updateWebhookEventStatus(db, eventId, { status: "ignored", reason: "provider_not_found" });
        set.status = 404;
        return { success: false, error: "provider_not_found" };
      }

      const spec = provider.spec as MessagingProviderSpec;
      const adapter = getMessagingAdapter(provider.type as MessagingType);
      const rawBody = typeof body === "string" ? body : JSON.stringify(body);
      const headerRecord: Record<string, string> = {};
      for (const [key, value] of Object.entries(headers)) {
        if (typeof value === "string") headerRecord[key] = value;
      }

      const verification = await adapter.verifyWebhook(
        spec?.signingSecret ?? "",
        headerRecord,
        rawBody,
      );

      // Handle Slack URL verification challenge
      if (verification.eventType === "url_verification") {
        wlog.info({ source: "slack", providerId: params.providerId, event: "url_verification" }, "webhook url verification");
        if (eventId) await updateWebhookEventStatus(db, eventId, { status: "processed" });
        const payload = verification.payload as { challenge?: string };
        return { challenge: payload.challenge };
      }

      if (!verification.valid) {
        wlog.warn({ source: "slack", providerId: params.providerId, event: slackEventType, channel: slackChannelId }, `slack webhook signature invalid (${slackEventType})`);
        if (eventId) await updateWebhookEventStatus(db, eventId, { status: "failed", reason: "invalid_signature" });
        set.status = 401;
        return { success: false, error: "invalid_signature" };
      }

      // Resolve user identity
      let principalId: string | null = null;
      if (verification.userId) {
        principalId = await resolveMessagingUser(
          db,
          provider.type,
          verification.userId,
        );
      }

      // Resolve channel context
      let entityContext: { entityKind: string; entityId: string } | null = null;
      if (verification.channelId) {
        entityContext = await resolveChannelContext(
          db,
          provider.id,
          verification.channelId,
        );
      }

      // Get or create thread and append message
      if (verification.channelId && verification.threadId) {
        const thread = await getOrCreateThread(db, {
          messagingProviderId: provider.id,
          externalChannelId: verification.channelId,
          externalThreadId: verification.threadId,
          initiatorPrincipalId: principalId ?? undefined,
          subject: verification.text?.slice(0, 100),
        });

        await appendMessage(db, thread.id, {
          role: "user",
          text: verification.text ?? "",
          externalUserId: verification.userId,
          principalId: principalId ?? undefined,
          timestamp: new Date().toISOString(),
        });
      }

      if (eventId) await updateWebhookEventStatus(db, eventId, { status: "processed" });

      wlog.info(
        { source: "slack", providerId: params.providerId, event: verification.eventType, channel: verification.channelId, user: verification.userId },
        `slack ${verification.eventType ?? slackEventType} processed${verification.channelId ? ` in ${verification.channelId}` : ""}${verification.text ? `: "${verification.text.slice(0, 60)}"` : ""}`,
      );

      return { success: true };
    },
    {
      params: t.Object({ providerId: t.String() }),
      detail: {
        tags: ["Webhooks"],
        summary: "Receive messaging platform webhook",
        security: [],
      },
    },
  );
}
