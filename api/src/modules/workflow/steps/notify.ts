/**
 * Notification steps — Slack messages, etc.
 */

import { getMessagingAdapter } from "../../../adapters/adapter-registry"
import type {
  MessagingConfig,
  MessagingType,
} from "../../../adapters/messaging-adapter"

export async function postSlackMessage(input: {
  channelId: string
  text: string
  threadId?: string
  messagingConfig: MessagingConfig
  messagingType?: MessagingType
}) {
  "use step"
  const adapter = getMessagingAdapter(input.messagingType ?? "slack")
  return adapter.sendMessage(input.messagingConfig, input.channelId, {
    text: input.text,
    threadId: input.threadId,
  })
}
