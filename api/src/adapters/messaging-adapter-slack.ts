import { createHmac, timingSafeEqual } from "crypto"
import type {
  MessagingAdapter,
  MessagingConfig,
  ExternalChannel,
  ExternalMessagingUser,
  MessagePayload,
  MessageResult,
  MessagingWebhookVerification,
} from "./messaging-adapter"
import { slack } from "./slack-client"

/**
 * Slack messaging adapter — uses direct HTTP calls via slack-client.ts
 * instead of @slack/web-api SDK (which fails under Bun's fetch).
 */
export class SlackMessagingAdapter implements MessagingAdapter {
  readonly type = "slack"

  async testConnection(
    config: MessagingConfig
  ): Promise<{ ok: boolean; error?: string }> {
    return slack.authTest(config.botToken)
  }

  async listChannels(config: MessagingConfig): Promise<ExternalChannel[]> {
    const channels = await slack.conversationsList(config.botToken)
    return channels.map((ch) => ({
      id: ch.id,
      name: ch.name ?? "",
      isPrivate: ch.is_private ?? false,
      topic: ch.topic?.value ?? undefined,
      purpose: ch.purpose?.value ?? undefined,
      memberCount: ch.num_members ?? undefined,
    }))
  }

  async listUsers(config: MessagingConfig): Promise<ExternalMessagingUser[]> {
    const members = await slack.usersList(config.botToken)
    return members.map((member) => ({
      id: member.id,
      email: member.profile?.email ?? null,
      displayName: member.profile?.display_name || member.name || member.id,
      realName: member.real_name ?? null,
      avatarUrl: member.profile?.image_72 ?? null,
      isBot: member.is_bot ?? false,
      deleted: member.deleted ?? false,
    }))
  }

  async sendMessage(
    config: MessagingConfig,
    channelId: string,
    message: MessagePayload
  ): Promise<MessageResult> {
    const result = await slack.chatPostMessage(config.botToken, {
      channel: channelId,
      text: message.text ?? "",
      blocks: message.blocks as unknown[],
      thread_ts: message.threadId,
    })
    return { messageId: result.ts, threadId: result.ts }
  }

  async updateMessage(
    config: MessagingConfig,
    channelId: string,
    messageId: string,
    message: MessagePayload
  ): Promise<void> {
    await slack.chatUpdate(config.botToken, {
      channel: channelId,
      ts: messageId,
      text: message.text ?? "",
      blocks: message.blocks as unknown[],
    })
  }

  async verifyWebhook(
    signingSecret: string,
    headers: Record<string, string>,
    body: string
  ): Promise<MessagingWebhookVerification> {
    const timestamp = headers["x-slack-request-timestamp"] ?? ""
    const slackSignature = headers["x-slack-signature"] ?? ""

    // Verify signature
    let valid = true
    if (signingSecret && slackSignature) {
      const sigBasestring = `v0:${timestamp}:${body}`
      const computed = `v0=${createHmac("sha256", signingSecret).update(sigBasestring).digest("hex")}`
      try {
        valid = timingSafeEqual(
          Buffer.from(computed),
          Buffer.from(slackSignature)
        )
      } catch {
        valid = false
      }
    }

    // Replay protection: reject if timestamp is > 5 minutes old
    const now = Math.floor(Date.now() / 1000)
    if (Math.abs(now - Number(timestamp)) > 300) {
      valid = false
    }

    let payload: Record<string, unknown> = {}
    try {
      payload = JSON.parse(body)
    } catch {
      return { valid: false, eventType: "unknown", eventId: "", payload: {} }
    }

    // url_verification challenge
    if (payload.type === "url_verification") {
      return {
        valid: true,
        eventType: "url_verification",
        eventId: "url_verification",
        payload,
      }
    }

    // event_callback
    const event = payload.event as Record<string, unknown> | undefined
    const eventId = (payload.event_id as string) ?? ""

    return {
      valid,
      eventType: (event?.type as string) ?? "unknown",
      eventId,
      userId: event?.user as string | undefined,
      channelId: event?.channel as string | undefined,
      threadId:
        (event?.thread_ts as string) ?? (event?.ts as string) ?? undefined,
      text: event?.text as string | undefined,
      payload,
    }
  }
}
