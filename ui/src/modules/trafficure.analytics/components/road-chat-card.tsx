import { use, useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import { useParams } from "react-router"
import remarkGfm from "remark-gfm"

import { AuthUIContext } from "@rio.js/auth-ui/lib/auth-ui-context"
import { Button } from "@rio.js/ui/button"
import { Icon, Icons } from "@rio.js/ui/icon"

import { useRoadHeaderDataQuery } from "../data/use-road-header-data-query"
import type { Road } from "../roads-data"

type Message = {
  id: string
  role: "user" | "assistant"
  content: string
}

export function RoadChatCard() {
  const { roadId } = useParams()
  const {
    hooks: { useActiveOrganization },
  } = use(AuthUIContext)
  const { data: activeOrganization } = useActiveOrganization()
  const { data: road } = useRoadHeaderDataQuery(roadId) as { data: Road | null }
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages])

  // Reset conversation when road changes
  useEffect(() => {
    setMessages([])
    setInput("")
  }, [roadId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || !roadId || !activeOrganization?.id || isLoading) return

    const userPrompt = input.trim() // Save the prompt before clearing input

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: userPrompt,
    }

    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    // Create assistant message placeholder
    const assistantMessageId = (Date.now() + 1).toString()
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
    }
    setMessages((prev) => [...prev, assistantMessage])

    // Extract road name from the road data
    const fullRoadName = road?.road_name ?? ""

    try {
      // Create abort controller for this request
      abortControllerRef.current = new AbortController()

      const response = await fetch("/api/v1/analytics/road-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roadId,
          organizationId: activeOrganization.id,
          roadName: fullRoadName || undefined,
          prompt: userPrompt, // Use saved prompt
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        throw new Error("No response body")
      }

      // Read the text stream
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value, { stream: true })

        // Append text directly to the assistant message
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? { ...m, content: m.content + text }
              : m
          )
        )
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        console.log("Request aborted")
      } else {
        console.error("Chat error:", error)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? {
                  ...m,
                  content: "Sorry, I encountered an error. Please try again.",
                }
              : m
          )
        )
      }
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }

  const handleClear = () => {
    setMessages([])
    setInput("")
  }

  return (
    <div className="px-4 flex flex-col gap-2">
      <div className="rounded-lg border border-scale-500 bg-scale-100 p-4">
        <div className="flex flex-col gap-3">
          {/* Header */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <i className="icon-[ph--sparkle-duotone] w-5 h-5 text-scale-1100" />
              <h2 className="text-md font-semibold text-scale-1200">
                Trafficure Assistant
              </h2>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-scale-300 text-scale-1000">
                Beta
              </span>
            </div>
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClear}
                className="h-auto px-2 py-1 text-xs"
              >
                <div className="flex items-center gap-1">
                  <i className="icon-[ph--trash-duotone] w-3.5 h-3.5" />
                  <span>Clear</span>
                </div>
              </Button>
            )}
          </div>

          {/* Messages */}
          <div className="flex flex-col gap-3">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center  text-center text-scale-1000">
                <i className="icon-[ph--chat-circle-dots-duotone] w-12 h-12 mb-2 opacity-50" />
                <p className="text-sm">
                  Ask me anything about this road's traffic data
                </p>
                <p className="text-xs mt-1 text-scale-900">
                  I can provide speed metrics, alert history, trends, and
                  patterns
                </p>
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-2 ${
                    message.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`rounded-lg px-3 py-2 max-w-[85%] ${
                      message.role === "user"
                        ? "bg-teal-500 text-white"
                        : "bg-scale-300 text-scale-1200"
                    }`}
                  >
                    {message.role === "assistant" &&
                    !message.content &&
                    isLoading ? (
                      <div className="flex items-center gap-2">
                        <Icon
                          icon={Icons.spinner}
                          className="w-4 h-4 animate-spin"
                        />
                        <span className="text-sm">Thinking...</span>
                      </div>
                    ) : (
                      <div
                        className={`text-sm ${message.role === "assistant" ? "prose prose-sm max-w-none prose-headings:text-scale-1200 prose-p:text-scale-1200 prose-li:text-scale-1200 prose-strong:text-scale-1200" : ""}`}
                      >
                        {message.role === "assistant" ? (
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {message.content || "(empty message)"}
                          </ReactMarkdown>
                        ) : (
                          <div className="whitespace-pre-wrap break-words text-white">
                            {message.content || "(empty message)"}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything about this road..."
              disabled={isLoading}
              className="w-full px-3 py-2 text-sm rounded-md border border-scale-500 bg-scale-100 text-scale-1200 placeholder:text-scale-900 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </form>
        </div>
      </div>
    </div>
  )
}
