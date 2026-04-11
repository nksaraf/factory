import type { FileUIPart, UIMessage } from "ai"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation } from "react-router"

import { useAgentChat } from "@rio.js/agents-ui"
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@rio.js/agents-ui/components/ai-elements/conversation"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@rio.js/agents-ui/components/ai-elements/message"
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSpeechButton,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@rio.js/agents-ui/components/ai-elements/prompt-input"
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@rio.js/agents-ui/components/ai-elements/reasoning"
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@rio.js/agents-ui/components/ai-elements/tool"
import { Badge } from "@rio.js/ui/components/badge"
import { ScrollArea } from "@rio.js/ui/components/scroll-area"
import { Separator } from "@rio.js/ui/components/separator"
import { Icon } from "@rio.js/ui/icon"

import {
  RESOURCE_TYPE_CONFIG,
  type ResourceTypeConfig,
} from "../../../constants/resource-config"
import type { Resource, ResourceDetail } from "../../../types"
import { useWorkbench } from "../../workbench-context"

// ─── Types ──────────────────────────────────────────────────────────────────

interface AgentSessionMeta {
  chatId?: string
  agentName?: string
  model?: string
  status?: "active" | "completed" | "error"
  totalTokens?: number
  startedAt?: string
  completedAt?: string
  systemPrompt?: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractSessionMeta(resource: ResourceDetail): AgentSessionMeta {
  const metaBlock = resource.blocks.find(
    (b) => b.blockType === "agent_session_meta"
  )
  return (metaBlock?.data as AgentSessionMeta) ?? {}
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status?: string }) {
  const variants: Record<string, { label: string; className: string }> = {
    active: {
      label: "Active",
      className: "bg-green-100 text-green-700 border-green-200",
    },
    completed: {
      label: "Completed",
      className: "bg-muted text-muted-foreground",
    },
    error: {
      label: "Error",
      className: "bg-red-100 text-red-700 border-red-200",
    },
  }
  const v = variants[status ?? ""] ?? variants.completed
  return (
    <Badge variant="outline" className={`text-xs ${v.className}`}>
      {v.label}
    </Badge>
  )
}

function SessionHeader({
  meta,
  onToggleInfo,
}: {
  meta: AgentSessionMeta
  onToggleInfo: () => void
}) {
  return (
    <div className="flex items-center justify-between border-b px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-100 text-teal-700">
          <Icon icon="icon-[ph--robot-duotone]" className="h-4 w-4" />
        </div>
        <div>
          <span className="text-sm font-medium">
            {meta.agentName || "AI Agent"}
          </span>
          {meta.model && (
            <span className="ml-2 text-xs text-muted-foreground font-mono">
              {meta.model}
            </span>
          )}
        </div>
        <StatusBadge status={meta.status} />
      </div>
      <button
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
        onClick={onToggleInfo}
      >
        <Icon icon="icon-[ph--gear-duotone]" className="h-4 w-4" />
      </button>
    </div>
  )
}

function MetadataField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </h3>
      <div>{children}</div>
    </div>
  )
}

function MetadataSidebar({
  meta,
  messageCount,
  resourceId,
}: {
  meta: AgentSessionMeta
  messageCount: number
  resourceId: string
}) {
  return (
    <div className="w-64 border-l bg-muted/20">
      <ScrollArea className="h-full">
        <div className="p-4 space-y-4">
          <MetadataField label="Agent">
            <p className="text-sm font-medium">
              {meta.agentName || "AI Agent"}
            </p>
          </MetadataField>

          <Separator />

          {meta.model && (
            <>
              <MetadataField label="Model">
                <span className="inline-flex items-center px-2 py-0.5 rounded bg-muted text-xs font-mono">
                  {meta.model}
                </span>
              </MetadataField>
              <Separator />
            </>
          )}

          <MetadataField label="Status">
            <StatusBadge status={meta.status} />
          </MetadataField>

          <Separator />

          <MetadataField label="Messages">
            <p className="text-sm font-medium">{messageCount}</p>
          </MetadataField>

          <Separator />

          {meta.totalTokens !== undefined && (
            <>
              <MetadataField label="Tokens Used">
                <p className="text-sm font-medium">
                  {meta.totalTokens.toLocaleString()}
                </p>
              </MetadataField>
              <Separator />
            </>
          )}

          {meta.startedAt && (
            <>
              <MetadataField label="Started">
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Icon
                    icon="icon-[ph--clock-duotone]"
                    className="h-3.5 w-3.5"
                  />
                  {new Date(meta.startedAt).toLocaleString()}
                </div>
              </MetadataField>
              <Separator />
            </>
          )}

          {meta.completedAt && (
            <MetadataField label="Completed">
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Icon icon="icon-[ph--clock-duotone]" className="h-3.5 w-3.5" />
                {new Date(meta.completedAt).toLocaleString()}
              </div>
            </MetadataField>
          )}

          {meta.systemPrompt && (
            <>
              <Separator />
              <MetadataField label="System Prompt">
                <p className="text-xs text-muted-foreground whitespace-pre-wrap bg-muted rounded-md p-2 max-h-40 overflow-auto">
                  {meta.systemPrompt}
                </p>
              </MetadataField>
            </>
          )}

          <Separator />

          <MetadataField label="Resource ID">
            <p className="text-xs font-mono text-muted-foreground break-all">
              {resourceId}
            </p>
          </MetadataField>
        </div>
      </ScrollArea>
    </div>
  )
}

// ─── Mention Popover ────────────────────────────────────────────────────────

const MENTIONABLE_TYPES = [
  "dataset",
  "report",
  "map",
  "dashboard",
  "pipeline",
  "ontology",
  "process",
] as const

interface MentionItem {
  id: string
  name: string
  resourceType: string
  config: ResourceTypeConfig
}

function MentionPopover({
  query,
  items,
  onSelect,
  onClose,
  visible,
}: {
  query: string
  items: MentionItem[]
  onSelect: (item: MentionItem) => void
  onClose: () => void
  visible: boolean
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  const filtered = useMemo(() => {
    if (!query) return items.slice(0, 8)
    const q = query.toLowerCase()
    return items
      .filter((item) => item.name.toLowerCase().includes(q))
      .slice(0, 8)
  }, [items, query])

  useEffect(() => {
    setSelectedIndex(0)
  }, [filtered])

  useEffect(() => {
    if (!visible) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % filtered.length)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex(
          (prev) => (prev - 1 + filtered.length) % filtered.length
        )
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        if (filtered[selectedIndex]) {
          onSelect(filtered[selectedIndex])
        }
      } else if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      }
    }

    document.addEventListener("keydown", handleKeyDown, true)
    return () => document.removeEventListener("keydown", handleKeyDown, true)
  }, [visible, filtered, selectedIndex, onSelect, onClose])

  if (!visible || filtered.length === 0) return null

  return (
    <div className="absolute bottom-full left-0 z-50 mb-1 w-72 rounded-lg border bg-popover p-1 shadow-md">
      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
        Resources
      </div>
      {filtered.map((item, idx) => (
        <button
          key={item.id}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
            idx === selectedIndex
              ? "bg-accent text-accent-foreground"
              : "hover:bg-accent/50"
          }`}
          onClick={() => onSelect(item)}
          onMouseEnter={() => setSelectedIndex(idx)}
        >
          <div
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${item.config.bgClass}`}
          >
            <Icon
              icon={item.config.icon}
              className={`h-3 w-3 ${item.config.iconClass}`}
            />
          </div>
          <span className="flex-1 truncate font-medium">{item.name}</span>
          <span className="text-xs text-muted-foreground">
            {item.config.label}
          </span>
        </button>
      ))}
    </div>
  )
}

// ─── Message Renderer ───────────────────────────────────────────────────────

function AgentMessage({
  message,
  isStreaming,
}: {
  message: UIMessage
  isStreaming: boolean
}) {
  if (message.role === "user") {
    const parts = message.parts ?? []
    const textParts = parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
    const text =
      textParts.length > 0
        ? textParts.join("\n")
        : typeof message.content === "string"
          ? message.content
          : ""

    const fileParts = parts.filter((p): p is FileUIPart => p.type === "file")

    return (
      <Message from="user">
        {fileParts.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {fileParts.map((file, idx) =>
              file.mediaType?.startsWith("image/") ? (
                <img
                  key={idx}
                  src={file.url}
                  alt={file.filename ?? "attachment"}
                  className="max-h-48 max-w-64 rounded-lg border object-cover"
                />
              ) : (
                <div
                  key={idx}
                  className="flex items-center gap-1.5 rounded-md border bg-muted/50 px-2.5 py-1.5 text-xs font-medium"
                >
                  <Icon
                    icon="icon-[ph--paperclip]"
                    className="h-3 w-3 text-muted-foreground"
                  />
                  {file.filename ?? "File"}
                </div>
              )
            )}
          </div>
        )}
        <MessageContent>{text}</MessageContent>
      </Message>
    )
  }

  if (message.role === "assistant") {
    const parts = message.parts ?? []
    const isLastMessage = isStreaming

    return (
      <Message from="assistant">
        {parts.map((part, idx) => {
          switch (part.type) {
            case "text":
              return (
                <MessageContent key={idx}>
                  <MessageResponse>{part.text}</MessageResponse>
                </MessageContent>
              )
            case "tool-invocation":
              return (
                <Tool key={part.toolInvocationId}>
                  <ToolHeader
                    title={part.toolName}
                    type={part.type}
                    state={part.state}
                  />
                  <ToolContent>
                    <ToolInput input={part.input} />
                    {"output" in part && (
                      <ToolOutput
                        output={part.output}
                        errorText={
                          part.state === "output-error"
                            ? String(part.output)
                            : undefined
                        }
                      />
                    )}
                  </ToolContent>
                </Tool>
              )
            case "reasoning":
              return (
                <Reasoning
                  key={idx}
                  isStreaming={isLastMessage && idx === parts.length - 1}
                >
                  <ReasoningTrigger />
                  <ReasoningContent>{part.reasoning}</ReasoningContent>
                </Reasoning>
              )
            default:
              return null
          }
        })}
      </Message>
    )
  }

  return null
}

// ─── Main View ──────────────────────────────────────────────────────────────

export default function AgentSessionDetailView({
  resource,
}: {
  resource: ResourceDetail
}) {
  const meta = extractSessionMeta(resource)
  const [showInfo, setShowInfo] = useState(false)
  const location = useLocation()
  const initialMessageSent = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const { resources } = useWorkbench()

  const chatId = meta.chatId ?? resource.id
  const isCompleted = meta.status === "completed" || meta.status === "error"

  const { messages, status, sendMessage, stop, isLoadingHistory } =
    useAgentChat({
      sessionId: chatId,
      api: "/api/chat/",
    })

  // Auto-send initial message passed via navigation state (e.g. from home chat input)
  useEffect(() => {
    const state = location.state as {
      initialMessage?: string
      initialFiles?: FileUIPart[]
    }
    const initialMessage = state?.initialMessage
    const initialFiles = state?.initialFiles

    if (initialMessage && !initialMessageSent.current && !isLoadingHistory) {
      initialMessageSent.current = true

      const parts: Array<
        | { type: "text"; text: string }
        | { type: "file"; url: string; mediaType: string; filename?: string }
      > = [{ type: "text", text: initialMessage }]

      if (initialFiles?.length) {
        for (const file of initialFiles) {
          parts.push({
            type: "file",
            url: file.url,
            mediaType: file.mediaType ?? "application/octet-stream",
            filename: file.filename,
          })
        }
      }

      sendMessage({ role: "user", parts })
    }
  }, [location.state, isLoadingHistory, sendMessage])

  const isStreaming = status === "streaming"

  // ─── Mentions ───────────────────────────────────────────────────────

  const mentionItems = useMemo<MentionItem[]>(() => {
    return resources
      .filter(
        (r) =>
          !r.deletedAt &&
          (MENTIONABLE_TYPES as readonly string[]).includes(r.resourceType)
      )
      .map((r) => ({
        id: r.id,
        name: r.name,
        resourceType: r.resourceType,
        config: RESOURCE_TYPE_CONFIG[r.resourceType],
      }))
  }, [resources])

  const [mentionQuery, setMentionQuery] = useState("")
  const [mentionVisible, setMentionVisible] = useState(false)
  const mentionStartPos = useRef<number | null>(null)

  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const textarea = e.currentTarget
      const value = textarea.value
      const cursorPos = textarea.selectionStart

      // Look for @ trigger
      const textBeforeCursor = value.slice(0, cursorPos)
      const lastAtIndex = textBeforeCursor.lastIndexOf("@")

      if (lastAtIndex >= 0) {
        const charBefore = lastAtIndex > 0 ? value[lastAtIndex - 1] : " "
        const query = textBeforeCursor.slice(lastAtIndex + 1)
        // Only trigger if @ is at start or preceded by whitespace, and no space in query
        if (
          (charBefore === " " || charBefore === "\n" || lastAtIndex === 0) &&
          !query.includes(" ")
        ) {
          mentionStartPos.current = lastAtIndex
          setMentionQuery(query)
          setMentionVisible(true)
          return
        }
      }

      setMentionVisible(false)
      mentionStartPos.current = null
    },
    []
  )

  const handleMentionSelect = useCallback((item: MentionItem) => {
    const textarea = textareaRef.current
    if (!textarea || mentionStartPos.current === null) return

    const value = textarea.value
    const before = value.slice(0, mentionStartPos.current)
    const after = value.slice(textarea.selectionStart)
    const mentionText = `@${item.name} `

    const newValue = before + mentionText + after
    // Dispatch via native input event so PromptInput picks up the change
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    )?.set
    nativeInputValueSetter?.call(textarea, newValue)
    textarea.dispatchEvent(new Event("input", { bubbles: true }))

    const newCursorPos = before.length + mentionText.length
    textarea.setSelectionRange(newCursorPos, newCursorPos)
    textarea.focus()

    setMentionVisible(false)
    mentionStartPos.current = null
  }, [])

  // ─── Submit handler ─────────────────────────────────────────────────

  const handleSubmit = async (message: {
    text: string
    files: FileUIPart[]
  }) => {
    if (!message.text.trim() && message.files.length === 0) return

    const parts: Array<
      | { type: "text"; text: string }
      | { type: "file"; url: string; mediaType: string; filename?: string }
    > = []

    if (message.text.trim()) {
      parts.push({ type: "text", text: message.text })
    }

    for (const file of message.files) {
      parts.push({
        type: "file",
        url: file.url,
        mediaType: file.mediaType ?? "application/octet-stream",
        filename: file.filename,
      })
    }

    sendMessage({
      role: "user",
      parts,
    })
  }

  return (
    <div className="flex h-full">
      {/* Chat area */}
      <div className="flex flex-1 flex-col">
        <SessionHeader
          meta={meta}
          onToggleInfo={() => setShowInfo(!showInfo)}
        />

        <Conversation>
          <ConversationContent>
            {isLoadingHistory ? (
              <div className="flex items-center justify-center py-16">
                <span className="text-sm text-muted-foreground">
                  Loading conversation...
                </span>
              </div>
            ) : messages.length === 0 ? (
              <ConversationEmptyState
                title="No messages yet"
                description="Start a conversation with the agent"
                icon={
                  <Icon
                    icon="icon-[ph--robot-duotone]"
                    className="h-12 w-12 opacity-30"
                  />
                }
              />
            ) : (
              messages.map((msg) => (
                <AgentMessage
                  key={msg.id}
                  message={msg}
                  isStreaming={
                    isStreaming && msg.id === messages[messages.length - 1]?.id
                  }
                />
              ))
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        {/* Input area */}
        <div className="relative border-t p-3">
          <MentionPopover
            query={mentionQuery}
            items={mentionItems}
            onSelect={handleMentionSelect}
            onClose={() => setMentionVisible(false)}
            visible={mentionVisible}
          />
          <PromptInput
            onSubmit={(message) => handleSubmit(message)}
            accept="image/*,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/json,text/plain"
            multiple
          >
            <PromptInputAttachments>
              {(attachment) => <PromptInputAttachment data={attachment} />}
            </PromptInputAttachments>
            <PromptInputTextarea
              ref={textareaRef}
              disabled={isCompleted}
              placeholder={
                isCompleted
                  ? "Session ended"
                  : "Message the agent... (@ to mention resources)"
              }
              onChange={handleTextareaChange}
            />
            <PromptInputFooter>
              <PromptInputTools>
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger />
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>
                <PromptInputButton
                  onClick={() => {
                    const textarea = textareaRef.current
                    if (!textarea) return
                    const value = textarea.value
                    const cursorPos = textarea.selectionStart
                    const before = value.slice(0, cursorPos)
                    const after = value.slice(cursorPos)
                    const newValue = before + "@" + after

                    const nativeInputValueSetter =
                      Object.getOwnPropertyDescriptor(
                        window.HTMLTextAreaElement.prototype,
                        "value"
                      )?.set
                    nativeInputValueSetter?.call(textarea, newValue)
                    textarea.dispatchEvent(
                      new Event("input", { bubbles: true })
                    )

                    const newPos = cursorPos + 1
                    textarea.setSelectionRange(newPos, newPos)
                    textarea.focus()

                    mentionStartPos.current = cursorPos
                    setMentionQuery("")
                    setMentionVisible(true)
                  }}
                  aria-label="Mention a resource"
                >
                  <Icon icon="icon-[ph--at]" className="size-4" />
                </PromptInputButton>
                <PromptInputSpeechButton textareaRef={textareaRef} />
              </PromptInputTools>
              <PromptInputSubmit
                status={status}
                disabled={isCompleted}
                onClick={
                  isStreaming
                    ? (e) => {
                        e.preventDefault()
                        stop()
                      }
                    : undefined
                }
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>

      {/* Metadata sidebar */}
      {showInfo && (
        <MetadataSidebar
          meta={meta}
          messageCount={messages.length}
          resourceId={resource.id}
        />
      )}
    </div>
  )
}
