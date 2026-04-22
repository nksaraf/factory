import { useMemo, useRef, useEffect, useState } from "react"
import { cn } from "@rio.js/ui"
import { Icon } from "@rio.js/ui/icon"
import type { ThreadExchange, ThreadMessage } from "../data/types"
import { ContentBlockRenderer } from "./content-blocks"
import { ROLE_ICON, formatDuration, formatTokens } from "./thread-helpers"

export function ExchangeView({
  messages,
  exchanges,
  threadStatus,
  cwd,
}: {
  messages: ThreadMessage[]
  exchanges: ThreadExchange[]
  threadStatus?: string
  cwd?: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length, autoScroll])

  const grouped = useMemo(
    () => groupByExchange(messages, exchanges),
    [messages, exchanges]
  )

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto px-4 py-6 space-y-6"
      onScroll={(e) => {
        const el = e.currentTarget
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100
        setAutoScroll(atBottom)
      }}
    >
      {grouped.map((group, i) => (
        <ExchangeCard
          key={group.exchange?.id ?? `orphan-${i}`}
          group={group}
          cwd={cwd}
        />
      ))}

      {threadStatus === "active" && (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground animate-pulse">
          <div className="h-2 w-2 rounded-full bg-emerald-500" />
          Working...
        </div>
      )}
    </div>
  )
}

interface ExchangeGroup {
  exchange: ThreadExchange | null
  messages: ThreadMessage[]
  userPrompt: ThreadMessage | null
  assistantResponse: ThreadMessage | null
  toolMessages: ThreadMessage[]
}

function groupByExchange(
  messages: ThreadMessage[],
  exchanges: ThreadExchange[]
): ExchangeGroup[] {
  if (exchanges.length === 0) {
    return [
      {
        exchange: null,
        messages,
        userPrompt: null,
        assistantResponse: null,
        toolMessages: [],
      },
    ]
  }

  const groups: ExchangeGroup[] = []

  for (const ex of exchanges) {
    const exStart = new Date(ex.startedAt).getTime()
    const exEnd = ex.endedAt ? new Date(ex.endedAt).getTime() : Infinity

    const exMessages = messages.filter((m) => {
      const t = new Date(m.startedAt).getTime()
      return t >= exStart && t <= exEnd
    })

    const userPrompt =
      exMessages.find(
        (m) =>
          m.role === "user" &&
          m.content.some((b) => b.type === "text") &&
          !m.content.some((b) => b.type === "tool_result")
      ) ?? null

    const restMessages = exMessages.filter((m) => m !== userPrompt)

    groups.push({
      exchange: ex,
      messages: exMessages,
      userPrompt,
      assistantResponse: null,
      toolMessages: restMessages,
    })
  }

  return groups
}

function ExchangeCard({ group, cwd }: { group: ExchangeGroup; cwd?: string }) {
  const { exchange, userPrompt, toolMessages } = group
  const [toolsExpanded, setToolsExpanded] = useState(false)

  const toolUseCount = toolMessages.reduce(
    (acc, m) => acc + m.content.filter((b) => b.type === "tool_use").length,
    0
  )

  const assistantTexts = toolMessages.filter(
    (m) => m.role === "assistant" && m.content.some((b) => b.type === "text")
  )
  const lastResponse = assistantTexts[assistantTexts.length - 1]
  const middleMessages = toolMessages.filter((m) => m !== lastResponse)

  return (
    <div className="space-y-3">
      {userPrompt && <MessageBubble message={userPrompt} cwd={cwd} />}

      {middleMessages.length > 0 && (
        <div className="rounded border border-dashed border-violet-700/20 bg-violet-50/20 dark:bg-violet-950/5 px-3 py-2">
          <button
            className="flex w-full items-center gap-2 text-xs text-violet-600 dark:text-violet-400"
            onClick={() => setToolsExpanded(!toolsExpanded)}
          >
            <Icon icon="icon-[ph--wrench-duotone]" className="h-3.5 w-3.5" />
            <span className="font-medium">
              {toolUseCount} tool call{toolUseCount !== 1 ? "s" : ""}
              {assistantTexts.length > 1
                ? `, ${assistantTexts.length - 1} intermediate responses`
                : ""}
            </span>
            <Icon
              icon={
                toolsExpanded ? "icon-[ph--caret-up]" : "icon-[ph--caret-down]"
              }
              className="ml-auto h-3 w-3"
            />
          </button>
          {toolsExpanded && (
            <div className="mt-3 space-y-2">
              {middleMessages.map((m) =>
                m.content.map((block, i) => (
                  <ContentBlockRenderer
                    key={`${m.id}-${i}`}
                    block={block}
                    cwd={cwd}
                  />
                ))
              )}
            </div>
          )}
        </div>
      )}

      {lastResponse && <MessageBubble message={lastResponse} cwd={cwd} />}

      {exchange && (
        <div className="flex items-center gap-3 px-2 text-xs text-muted-foreground/50">
          <span>{exchange.status}</span>
          {exchange.endedAt && (
            <span>{formatDuration(exchange.startedAt, exchange.endedAt)}</span>
          )}
        </div>
      )}
    </div>
  )
}

function MessageBubble({
  message,
  cwd,
}: {
  message: ThreadMessage
  cwd?: string
}) {
  const isUser = message.role === "user"
  const isSystem = message.role === "system"
  const icon = ROLE_ICON[message.role] ?? ROLE_ICON.assistant

  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3",
        isUser && "border-sky-700/30 bg-sky-50/50 dark:bg-sky-950/20",
        !isUser && !isSystem && "border-border bg-card",
        isSystem && "border-amber-700/30 bg-amber-50/30 dark:bg-amber-950/10"
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Icon icon={icon} className="h-3.5 w-3.5" />
        <span className="font-medium capitalize">{message.role}</span>
        {message.spec.model && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
            {message.spec.model.replace("claude-", "").replace("-20250514", "")}
          </span>
        )}
        {message.spec.usage && (
          <span className="ml-auto">
            {formatTokens(message.spec.usage.inputTokens)}in /{" "}
            {formatTokens(message.spec.usage.outputTokens)}out
          </span>
        )}
      </div>
      <div className="space-y-2">
        {message.content.map((block, i) => (
          <ContentBlockRenderer key={i} block={block} cwd={cwd} />
        ))}
      </div>
    </div>
  )
}
