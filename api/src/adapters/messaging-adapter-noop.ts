import { logger } from "../logger";
import type {
  MessagingAdapter,
  MessagingConfig,
  ExternalChannel,
  ExternalMessagingUser,
  MessagePayload,
  MessageResult,
  MessagingWebhookVerification,
} from "./messaging-adapter";

export class NoopMessagingAdapter implements MessagingAdapter {
  readonly type = "noop";

  async testConnection(
    _config: MessagingConfig,
  ): Promise<{ ok: boolean; error?: string }> {
    logger.debug("noop messaging: testConnection");
    return { ok: true };
  }

  async listChannels(_config: MessagingConfig): Promise<ExternalChannel[]> {
    logger.debug("noop messaging: listChannels");
    return [];
  }

  async listUsers(_config: MessagingConfig): Promise<ExternalMessagingUser[]> {
    logger.debug("noop messaging: listUsers");
    return [];
  }

  async sendMessage(
    _config: MessagingConfig,
    _channelId: string,
    _message: MessagePayload,
  ): Promise<MessageResult> {
    logger.debug("noop messaging: sendMessage");
    return { messageId: "noop-msg-id" };
  }

  async updateMessage(
    _config: MessagingConfig,
    _channelId: string,
    _messageId: string,
    _message: MessagePayload,
  ): Promise<void> {
    logger.debug("noop messaging: updateMessage");
  }

  async verifyWebhook(
    _signingSecret: string,
    _headers: Record<string, string>,
    _body: string,
  ): Promise<MessagingWebhookVerification> {
    logger.debug("noop messaging: verifyWebhook");
    return {
      valid: true,
      eventType: "noop",
      eventId: "noop-event-id",
      payload: {},
    };
  }
}
