import { Elysia, t } from "elysia";
import type { Database } from "../../db/connection";
import { getMessagingAdapter } from "../../adapters/adapter-registry";
import {
  getMessagingProvider,
  resolveMessagingUser,
  resolveChannelContext,
  getOrCreateThread,
  appendMessage,
} from "./messaging.service";
import { dispatchAgentJob } from "../agent/dispatch";

export function messagingWebhookController(db: Database) {
  return new Elysia({ prefix: "/webhooks" }).post(
    "/messaging/:providerId",
    async ({ params, headers, body, set }) => {
      const provider = await getMessagingProvider(db, params.providerId);
      if (!provider) {
        set.status = 404;
        return { success: false, error: "provider_not_found" };
      }

      const adapter = getMessagingAdapter(provider.kind);
      const rawBody = typeof body === "string" ? body : JSON.stringify(body);
      const headerRecord: Record<string, string> = {};
      for (const [key, value] of Object.entries(headers)) {
        if (typeof value === "string") headerRecord[key] = value;
      }

      const verification = await adapter.verifyWebhook(
        provider.signingSecret ?? "",
        headerRecord,
        rawBody,
      );

      // Handle Slack URL verification challenge
      if (verification.eventType === "url_verification") {
        const payload = verification.payload as { challenge?: string };
        return { challenge: payload.challenge };
      }

      if (!verification.valid) {
        set.status = 401;
        return { success: false, error: "invalid_signature" };
      }

      // Resolve user identity
      let principalId: string | null = null;
      if (verification.userId) {
        principalId = await resolveMessagingUser(
          db,
          provider.kind,
          verification.userId,
        );
      }

      // Resolve channel context
      let entityContext: { entityKind: string; entityId: string } | null = null;
      if (verification.channelId) {
        entityContext = await resolveChannelContext(
          db,
          provider.messagingProviderId,
          verification.channelId,
        );
      }

      // Get or create thread and append message
      if (verification.channelId && verification.threadId) {
        const thread = await getOrCreateThread(db, {
          messagingProviderId: provider.messagingProviderId,
          externalChannelId: verification.channelId,
          externalThreadId: verification.threadId,
          initiatorPrincipalId: principalId ?? undefined,
          subject: verification.text?.slice(0, 100),
        });

        await appendMessage(db, thread.messageThreadId, {
          role: "user",
          text: verification.text ?? "",
          externalUserId: verification.userId,
          principalId: principalId ?? undefined,
          timestamp: new Date().toISOString(),
        });

        // Dispatch to agent for processing
        if (verification.text) {
          await dispatchAgentJob(db, {
            providerId: params.providerId,
            channelId: verification.channelId!,
            threadId: verification.threadId!,
            messageThreadId: thread.messageThreadId,
            text: verification.text,
            principalId,
            entityContext,
          });
        }
      }

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
