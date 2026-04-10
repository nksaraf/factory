import { createSlackAdapter } from "@chat-adapter/slack"
import { createMemoryState } from "@chat-adapter/state-memory"
import { Chat } from "chat"

import { logger } from "../../logger"

const log = logger.child({ module: "chat-sdk" })

export const bot = new Chat({
  userName: "factory-bot",
  adapters: { slack: createSlackAdapter() },
  state: createMemoryState(),
})

log.info("Chat SDK bot initialized")
