/**
 * MessagingAdapter — interface for external messaging providers (Slack, Teams, Google Chat, etc.)
 *
 * Analogous to WorkTrackerAdapter / GitHostAdapter.
 * Stateless: receives connection config per call.
 */

export interface MessagingConfig {
  botToken: string;
  signingSecret: string;
  workspaceExternalId?: string;
}

export interface ExternalChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  topic?: string;
  purpose?: string;
  memberCount?: number;
}

export interface ExternalMessagingUser {
  id: string;
  email: string | null;
  displayName: string;
  realName: string | null;
  avatarUrl: string | null;
  isBot: boolean;
  deleted: boolean;
}

export interface MessagePayload {
  text?: string;
  blocks?: unknown[];
  threadId?: string;
}

export interface MessageResult {
  messageId: string;
  threadId?: string;
}

export interface MessagingWebhookVerification {
  valid: boolean;
  eventType: string;
  eventId: string;
  userId?: string;
  channelId?: string;
  threadId?: string;
  text?: string;
  payload: Record<string, unknown>;
}

export interface MessagingAdapter {
  readonly type: string;

  testConnection(
    config: MessagingConfig,
  ): Promise<{ ok: boolean; error?: string }>;

  listChannels(config: MessagingConfig): Promise<ExternalChannel[]>;

  listUsers(config: MessagingConfig): Promise<ExternalMessagingUser[]>;

  sendMessage(
    config: MessagingConfig,
    channelId: string,
    message: MessagePayload,
  ): Promise<MessageResult>;

  updateMessage(
    config: MessagingConfig,
    channelId: string,
    messageId: string,
    message: MessagePayload,
  ): Promise<void>;

  verifyWebhook(
    signingSecret: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<MessagingWebhookVerification>;
}
