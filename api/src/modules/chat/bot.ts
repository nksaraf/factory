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

// Use Postgres-backed state for production persistence, fall back to in-memory
let state: any
const dbUrl = (
  process.env.FACTORY_DATABASE_URL ??
  process.env.DATABASE_URL ??
  ""
).trim()
if (dbUrl) {
  try {
    const { createPostgresState } = await import("@chat-adapter/state-pg")
    state = createPostgresState({
      url: dbUrl,
      keyPrefix: "factory-bot",
    })
    log.info("Chat SDK using Postgres state adapter")
  } catch (err) {
    log.warn(
      { err },
      "Postgres state adapter failed — falling back to in-memory"
    )
    state = createMemoryState()
  }
} else {
  log.info("No DATABASE_URL — Chat SDK using in-memory state")
  state = createMemoryState()
}

export const bot = new Chat({
  userName: "factory-bot",
  adapters,
  state,
})
