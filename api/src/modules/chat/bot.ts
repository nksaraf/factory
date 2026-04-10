// must be first — patches @slack/web-api for Bun HTTPS compat
import "./bun-https-fix"

import { createMemoryState } from "@chat-adapter/state-memory"
import { Chat } from "chat"

import { logger } from "../../logger"

const log = logger.child({ module: "chat-sdk" })

const adapters: Record<string, any> = {}

if (process.env.SLACK_SIGNING_SECRET) {
  const { createSlackAdapter } = await import("@chat-adapter/slack")
  adapters.slack = createSlackAdapter()
  log.info("Chat SDK bot initialized with Slack adapter")
} else {
  log.warn("SLACK_SIGNING_SECRET not set — Slack adapter disabled")
}

export const bot = new Chat({
  userName: "factory-bot",
  adapters,
  state: createMemoryState(),
})
