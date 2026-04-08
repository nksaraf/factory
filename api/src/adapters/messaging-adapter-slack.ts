import { WebClient } from "@slack/web-api";
import { createHmac, timingSafeEqual } from "crypto";
import type {
  MessagingAdapter,
  MessagingConfig,
  ExternalChannel,
  ExternalMessagingUser,
  MessagePayload,
  MessageResult,
  MessagingWebhookVerification,
} from "./messaging-adapter";
import { slackClient } from "./slack-client";

/**
 * Slack messaging adapter using @slack/web-api
 *
 * API methods used:
 * - testConnection: auth.test
 * - listChannels: conversations.list (paginated)
 * - listUsers: users.list (paginated)
 * - sendMessage: chat.postMessage
 * - updateMessage: chat.update
 * - verifyWebhook: HMAC-SHA256 (x-slack-signature / x-slack-request-timestamp)
 */
export class SlackMessagingAdapter implements MessagingAdapter {
  readonly type = "slack";

  private client(token: string): WebClient {
    return slackClient(token);
  }

  async testConnection(
    config: MessagingConfig,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const result = await this.client(config.botToken).auth.test();
      if (!result.ok) return { ok: false, error: result.error ?? "unknown" };
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async listChannels(config: MessagingConfig): Promise<ExternalChannel[]> {
    const client = this.client(config.botToken);
    const channels: ExternalChannel[] = [];
    let cursor: string | undefined;

    do {
      const result = await client.conversations.list({
        types: "public_channel,private_channel",
        limit: 200,
        cursor,
      });

      for (const ch of result.channels ?? []) {
        channels.push({
          id: ch.id!,
          name: ch.name ?? "",
          isPrivate: ch.is_private ?? false,
          topic: ch.topic?.value ?? undefined,
          purpose: ch.purpose?.value ?? undefined,
          memberCount: ch.num_members ?? undefined,
        });
      }

      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);

    return channels;
  }

  async listUsers(
    config: MessagingConfig,
  ): Promise<ExternalMessagingUser[]> {
    const client = this.client(config.botToken);
    const users: ExternalMessagingUser[] = [];
    let cursor: string | undefined;

    do {
      const result = await client.users.list({ limit: 200, cursor });

      for (const member of result.members ?? []) {
        users.push({
          id: member.id!,
          email: member.profile?.email ?? null,
          displayName:
            member.profile?.display_name || member.name || member.id!,
          realName: member.real_name ?? null,
          avatarUrl: member.profile?.image_72 ?? null,
          isBot: member.is_bot ?? false,
          deleted: member.deleted ?? false,
        });
      }

      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);

    return users;
  }

  async sendMessage(
    config: MessagingConfig,
    channelId: string,
    message: MessagePayload,
  ): Promise<MessageResult> {
    const result = await this.client(config.botToken).chat.postMessage({
      channel: channelId,
      text: message.text ?? "",
      blocks: message.blocks as any,
      thread_ts: message.threadId,
    });

    return {
      messageId: result.ts!,
      threadId: result.ts,
    };
  }

  async updateMessage(
    config: MessagingConfig,
    channelId: string,
    messageId: string,
    message: MessagePayload,
  ): Promise<void> {
    await this.client(config.botToken).chat.update({
      channel: channelId,
      ts: messageId,
      text: message.text ?? "",
      blocks: message.blocks as any,
    });
  }

  async verifyWebhook(
    signingSecret: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<MessagingWebhookVerification> {
    const timestamp = headers["x-slack-request-timestamp"] ?? "";
    const slackSignature = headers["x-slack-signature"] ?? "";

    // Verify signature
    let valid = true;
    if (signingSecret && slackSignature) {
      const sigBasestring = `v0:${timestamp}:${body}`;
      const computed = `v0=${createHmac("sha256", signingSecret).update(sigBasestring).digest("hex")}`;
      try {
        valid = timingSafeEqual(
          Buffer.from(computed),
          Buffer.from(slackSignature),
        );
      } catch {
        valid = false;
      }
    }

    // Replay protection: reject if timestamp is > 5 minutes old
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(timestamp)) > 300) {
      valid = false;
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(body);
    } catch {
      return { valid: false, eventType: "unknown", eventId: "", payload: {} };
    }

    // url_verification challenge
    if (payload.type === "url_verification") {
      return {
        valid: true,
        eventType: "url_verification",
        eventId: "url_verification",
        payload,
      };
    }

    // event_callback
    const event = payload.event as Record<string, unknown> | undefined;
    const eventId = (payload.event_id as string) ?? "";

    return {
      valid,
      eventType: event?.type as string ?? "unknown",
      eventId,
      userId: event?.user as string | undefined,
      channelId: event?.channel as string | undefined,
      threadId: (event?.thread_ts as string) ?? (event?.ts as string) ?? undefined,
      text: event?.text as string | undefined,
      payload,
    };
  }
}
