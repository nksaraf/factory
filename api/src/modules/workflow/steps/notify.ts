/**
 * Notification steps — Slack messages, etc.
 */

import { createStep } from "../../../lib/workflow-engine";
import { getMessagingAdapter } from "../../../adapters/adapter-registry";
import type { MessagingConfig, MessagingType } from "../../../adapters/messaging-adapter";

export const postSlackMessage = createStep({
  name: "notify.slack",
  fn: async (input: {
    channelId: string;
    text: string;
    threadId?: string;
    messagingConfig: MessagingConfig;
    messagingType?: MessagingType;
  }) => {
    const adapter = getMessagingAdapter(input.messagingType ?? "slack");
    return adapter.sendMessage(input.messagingConfig, input.channelId, {
      text: input.text,
      threadId: input.threadId,
    });
  },
});
