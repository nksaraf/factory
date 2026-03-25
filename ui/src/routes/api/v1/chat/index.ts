import { google } from "@ai-sdk/google"
import { type UIMessage, generateId, streamText } from "ai"
import { eventHandler, readBody } from "vinxi/http"

import { defaultMessageStore } from "@rio.js/agents-ui"

// In-memory resumable stream storage (shim for Redis in production)
const activeStreams = new Map<string, ReadableStream>()

export const POST = eventHandler(async (event) => {
  const body = await readBody(event)
  const { id: chatId, message } = body as {
    id: string
    message: UIMessage
  }

  // Load existing messages from store and append the new one
  const chatData = await defaultMessageStore.readChat(chatId)
  const messages = [...chatData.messages, message]

  // Save user message immediately
  await defaultMessageStore.saveChat(chatId, {
    messages,
    activeStreamId: null,
  })

  // Check for API key — use mock echo if not available
  const hasApiKey = !!process.env.GOOGLE_GENERATIVE_AI_API_KEY
  if (!hasApiKey) {
    return mockStreamResponse(chatId, messages, message)
  }

  const result = streamText({
    model: google("gemini-2.0-flash"),
    messages: messages.map((m) => ({
      role: m.role,
      content:
        typeof m.content === "string"
          ? m.content
          : (m.parts
              ?.filter(
                (p): p is { type: "text"; text: string } => p.type === "text"
              )
              .map((p) => p.text)
              .join("\n") ?? ""),
    })),
  })

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onFinish: async ({ messages: finalMessages }) => {
      await defaultMessageStore.saveChat(chatId, {
        messages: finalMessages,
        activeStreamId: null,
      })
    },
    async consumeSseStream({ stream }) {
      const streamId = generateId()
      // Store the stream for potential resumption
      const [streamForResponse, streamForStorage] = stream.tee()
      activeStreams.set(streamId, streamForStorage)
      await defaultMessageStore.saveChat(chatId, { activeStreamId: streamId })

      // Clean up stream reference when it finishes
      streamForStorage
        .pipeTo(new WritableStream())
        .finally(() => activeStreams.delete(streamId))

      return streamForResponse
    },
  })
})

/** Mock streaming response when no API key is configured */
function mockStreamResponse(
  _chatId: string,
  _allMessages: UIMessage[],
  lastMessage: UIMessage
) {
  const userText =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : (lastMessage.parts
          ?.filter(
            (p): p is { type: "text"; text: string } => p.type === "text"
          )
          .map((p) => p.text)
          .join("\n") ?? "")

  const mockResponse = `I received your message: "${userText}"\n\nThis is a mock response because no GOOGLE_GENERATIVE_AI_API_KEY is configured. Set the environment variable to enable real AI responses.`

  const messageId = generateId()
  const textPartId = generateId()

  // Build SSE chunks using AI SDK v6 UI Message Stream protocol
  const chunks: string[] = [
    `data: ${JSON.stringify({ type: "start", messageId })}\n\n`,
    `data: ${JSON.stringify({ type: "text-start", id: textPartId })}\n\n`,
  ]

  // Stream word by word
  const words = mockResponse.split(" ")
  for (let i = 0; i < words.length; i++) {
    const delta = i < words.length - 1 ? words[i] + " " : words[i]
    chunks.push(
      `data: ${JSON.stringify({ type: "text-delta", id: textPartId, delta })}\n\n`
    )
  }

  chunks.push(
    `data: ${JSON.stringify({ type: "text-end", id: textPartId })}\n\n`,
    `data: ${JSON.stringify({ type: "finish" })}\n\n`,
    `data: [DONE]\n\n`
  )

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
        await new Promise((r) => setTimeout(r, 30))
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "x-vercel-ai-ui-message-stream": "v1",
    },
  })
}
