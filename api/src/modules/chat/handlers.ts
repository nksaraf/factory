import { logger } from "../../logger"
import { bot } from "./bot"

const log = logger.child({ module: "chat-handlers" })

bot.onNewMention(async (thread, message) => {
  log.info({ text: message.text?.slice(0, 100) }, "New mention received")
  await thread.subscribe()
  await thread.post("Echo: " + (message.text ?? ""))
})

bot.onSubscribedMessage(async (thread, message) => {
  log.info({ text: message.text?.slice(0, 100) }, "Subscribed message received")
  await thread.post("Follow-up echo: " + (message.text ?? ""))
})
