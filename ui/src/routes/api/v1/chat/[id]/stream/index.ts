import { eventHandler, getRouterParam } from "vinxi/http"

import { defaultMessageStore } from "@rio.js/agents-ui"

export const GET = eventHandler(async (event) => {
  const chatId = getRouterParam(event, "id")
  if (!chatId) {
    return new Response("Missing chat ID", { status: 400 })
  }

  const chatData = await defaultMessageStore.readChat(chatId)

  if (!chatData.activeStreamId) {
    // No active stream — tell client there's nothing to resume
    return new Response(null, { status: 204 })
  }

  // In a production setup with Redis + resumable-stream package,
  // we'd reconnect to the stored stream here. For the in-memory shim,
  // we return 204 since the stream only lives in the original response.
  // The client will handle this gracefully by showing the last persisted state.
  return new Response(null, { status: 204 })
})
