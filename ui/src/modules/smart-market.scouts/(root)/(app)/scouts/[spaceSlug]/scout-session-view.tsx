import { useEffect, useMemo, useRef, useState } from "react"
import { useResource } from "~/src/modules/smart-market.workspaces/data/use-resource"
import type { ResourceDetail } from "~/src/modules/smart-market.workspaces/types"

import { Badge } from "@rio.js/ui/components/badge"
import { Button } from "@rio.js/ui/components/button"
import { ScrollArea } from "@rio.js/ui/components/scroll-area"
import { Icon } from "@rio.js/ui/icon"
import { Textarea } from "@rio.js/ui/textarea"

// ── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: string
  toolCalls?: { name: string; status: "success" | "error" | "pending" }[]
  isStreaming?: boolean
}

interface SessionMeta {
  agentName?: string
  model?: string
  status?: "active" | "completed" | "error"
  systemPrompt?: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractMeta(resource: ResourceDetail): SessionMeta {
  const b = resource.blocks.find((b) => b.blockType === "agent_session_meta")
  return (b?.data as SessionMeta) ?? {}
}

function extractMessages(resource: ResourceDetail): ChatMessage[] {
  return resource.blocks
    .filter((b) => b.blockType === "agent_message")
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map((b) => ({
      id: b.id,
      role: (b.data.role as ChatMessage["role"]) ?? "user",
      content: (b.data.content as string) ?? "",
      timestamp: (b.data.timestamp as string) ?? b.createdAt,
      toolCalls: b.data.toolCalls as ChatMessage["toolCalls"],
    }))
}

// ── Mock streaming response ──────────────────────────────────────────────────

const MOCK_RESPONSES = [
  "I'll analyze the data for you. Based on the workspace datasets, here are the key insights:\n\n**Coverage Analysis:**\n- Current outlet density in the target area is 3.8 outlets/km\u00b2\n- Competitor coverage gap identified in the western corridor\n- Estimated revenue uplift of 12-18% with 3 new placements\n\nWould you like me to drill into any specific zone?",
  "Looking at the latest transaction data, I can see a clear pattern:\n\n1. **Peak hours** are between 10 AM - 1 PM and 5 PM - 8 PM\n2. **UPI payments** account for 62% of all transactions\n3. **Beverage category** has the highest margin at 34%\n\nI've cross-referenced this with footfall data from the outlet locations dataset. The correlation coefficient between footfall and daily revenue is 0.87, which is quite strong.",
  "I've completed the spatial analysis you requested. Here's what I found:\n\n**High Potential Zones:**\n- Malad West: Score 92/100 \u2014 low competition, high residential density\n- Ghatkopar East: Score 87/100 \u2014 near transit hub, growing commercial area\n- Borivali West: Score 84/100 \u2014 underserved despite strong demographics\n\nI used the outlet locations, competitor density map, and demographic data from your workspace to generate these scores. Want me to create a detailed report for any of these zones?",
]

function simulateStream(
  text: string,
  onChunk: (partial: string) => void,
  onDone: () => void
) {
  let i = 0
  const words = text.split(" ")
  const interval = setInterval(() => {
    if (i >= words.length) {
      clearInterval(interval)
      onDone()
      return
    }
    const chunk = words.slice(0, i + 1).join(" ")
    onChunk(chunk)
    i++
  }, 30)
  return () => clearInterval(interval)
}

// ── Components ───────────────────────────────────────────────────────────────

const toolCallStyles = {
  success: "bg-success-50 text-success-700 border-success-200",
  error: "bg-destructive-50 text-destructive-700 border-destructive-200",
  pending: "bg-warning-50 text-warning-700 border-warning-200",
} as const

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "system") {
    return (
      <div className="flex justify-center py-2">
        <span className="text-xs text-muted-foreground/60 italic bg-muted/50 px-3 py-1 rounded-full">
          {message.content}
        </span>
      </div>
    )
  }

  const isUser = message.role === "user"

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : ""}`}>
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700">
          <Icon icon="icon-[ph--robot-duotone]" className="h-4 w-4" />
        </div>
      )}
      <div
        className={`flex flex-col gap-1.5 ${isUser ? "items-end max-w-[70%]" : "max-w-[75%]"}`}
      >
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? "bg-primary text-primary-foreground rounded-br-md"
              : "bg-muted rounded-bl-md"
          }`}
        >
          <div className="whitespace-pre-wrap">{message.content}</div>
          {message.isStreaming && (
            <span
              className="inline-block w-1.5 h-4 bg-current animate-pulse ml-0.5 align-middle"
              role="status"
              aria-label="Generating response"
            />
          )}
        </div>
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="flex flex-wrap gap-1 px-1">
            {message.toolCalls.map((tc, i) => (
              <span
                key={i}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-mono border ${toolCallStyles[tc.status]}`}
              >
                <Icon
                  icon="icon-[ph--sparkle-duotone]"
                  className="h-2.5 w-2.5"
                />
                {tc.name}
              </span>
            ))}
          </div>
        )}
      </div>
      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Icon icon="icon-[ph--user-duotone]" className="h-4 w-4" />
        </div>
      )}
    </div>
  )
}

function ChatInput({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void
  disabled?: boolean
}) {
  const [input, setInput] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = () => {
    const text = input.trim()
    if (!text || disabled) return
    onSend(text)
    setInput("")
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 160) + "px"
  }

  return (
    <div className="border-t bg-background p-4">
      <div className="mx-auto max-w-3xl">
        <div className="relative flex items-end gap-2 rounded-2xl border bg-background px-4 py-3 shadow-sm focus-within:ring-1 focus-within:ring-ring">
          <button
            className="shrink-0 pb-0.5 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            aria-label="Attach file"
          >
            <Icon icon="icon-[ph--paperclip]" className="h-5 w-5" />
          </button>
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Send a message..."
            disabled={disabled}
            rows={1}
            className="min-h-[24px] max-h-[160px] resize-none border-0 p-0 shadow-none focus-visible:ring-0 text-sm"
          />
          <Button
            size="icon"
            className="h-8 w-8 shrink-0 rounded-full"
            disabled={disabled || !input.trim()}
            onClick={handleSubmit}
            aria-label={disabled ? "Generating response" : "Send message"}
          >
            {disabled ? (
              <Icon
                icon="icon-[ph--spinner]"
                className="h-4 w-4 animate-spin"
              />
            ) : (
              <Icon icon="icon-[ph--arrow-up-bold]" className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="mt-2 text-center text-xs text-muted-foreground/40">
          AI responses are generated from your workspace data. Always verify
          critical insights.
        </p>
      </div>
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────

export function ScoutSessionView({
  sessionId,
  onBack,
}: {
  sessionId: string
  onBack: () => void
}) {
  const { data: resource, isLoading } = useResource(sessionId)
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  const meta = resource ? extractMeta(resource) : ({} as SessionMeta)
  const serverMessages = useMemo(
    () => (resource ? extractMessages(resource) : []),
    [resource]
  )
  const allMessages = [...serverMessages, ...localMessages]

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current.querySelector(
        "[data-radix-scroll-area-viewport]"
      )
      if (el) {
        el.scrollTop = el.scrollHeight
      }
    }
  }, [allMessages.length, localMessages])

  // Cleanup streaming on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current?.()
    }
  }, [])

  const handleSend = (text: string) => {
    const userMsg: ChatMessage = {
      id: `local_user_${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    }

    const assistantMsg: ChatMessage = {
      id: `local_asst_${Date.now()}`,
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      isStreaming: true,
    }

    setLocalMessages((prev) => [...prev, userMsg, assistantMsg])
    setIsStreaming(true)

    const response =
      MOCK_RESPONSES[Math.floor(Math.random() * MOCK_RESPONSES.length)]

    cleanupRef.current = simulateStream(
      response,
      (partial) => {
        setLocalMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: partial } : m
          )
        )
      },
      () => {
        setLocalMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? {
                  ...m,
                  content: response,
                  isStreaming: false,
                  toolCalls: [
                    { name: "query_dataset", status: "success" as const },
                    { name: "spatial_analysis", status: "success" as const },
                  ],
                }
              : m
          )
        )
        setIsStreaming(false)
        cleanupRef.current = null
      }
    )
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center" role="status">
        <Icon
          icon="icon-[ph--spinner]"
          className="h-6 w-6 animate-spin text-muted-foreground"
        />
      </div>
    )
  }

  if (!resource) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Icon
          icon="icon-[ph--robot-duotone]"
          className="h-12 w-12 opacity-30"
        />
        <p className="text-sm">Session not found</p>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <Icon icon="icon-[ph--caret-left]" className="mr-1 h-4 w-4" />
          Back
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-4 py-2.5 bg-background">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onBack}
          aria-label="Back to sessions"
        >
          <Icon icon="icon-[ph--caret-left]" className="h-4 w-4" />
        </Button>
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-100 text-primary-700">
          <Icon icon="icon-[ph--robot-duotone]" className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">
              {resource.name}
            </span>
            <Badge
              variant="outline"
              className={`text-xs ${
                meta.status === "active"
                  ? "bg-success-50 text-success-700 border-success-200"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {meta.status === "active" ? "Active" : "Completed"}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{meta.agentName || "AI Agent"}</span>
            {meta.model && (
              <>
                <span>&middot;</span>
                <span className="font-mono">{meta.model}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea ref={scrollRef} className="flex-1">
        <div
          className="mx-auto max-w-3xl flex flex-col gap-6 px-4 py-6"
          role="log"
          aria-label="Chat messages"
          aria-live="polite"
        >
          {allMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-24 text-muted-foreground">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-50">
                <Icon
                  icon="icon-[ph--robot-duotone]"
                  className="h-8 w-8 text-primary-600"
                />
              </div>
              <div className="text-center">
                <p className="text-base font-medium text-foreground">
                  {meta.agentName || "AI Agent"}
                </p>
                <p className="mt-1 text-sm">
                  Ask me anything about your workspace data
                </p>
              </div>
            </div>
          ) : (
            allMessages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <ChatInput onSend={handleSend} disabled={isStreaming} />
    </div>
  )
}
