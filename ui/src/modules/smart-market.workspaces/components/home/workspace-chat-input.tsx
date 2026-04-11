import type { FileUIPart } from "ai"
import { useCallback, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router"

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
import { Icon } from "@rio.js/ui/icon"

import {
  RESOURCE_TYPE_CONFIG,
  type ResourceTypeConfig,
} from "../../constants/resource-config"
import { useCreateResource } from "../../data/use-create-resource"
import { useWorkbench } from "../workbench-context"

// ─── Mention types & popover ────────────────────────────────────────────────

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

  // Reset selection on filter change
  const prevFilteredRef = useRef(filtered)
  if (prevFilteredRef.current !== filtered) {
    prevFilteredRef.current = filtered
  }

  // Keyboard navigation is captured at document level
  // so it intercepts before the textarea handles Enter/arrows
  const handleKeyDownRef = useRef<((e: KeyboardEvent) => void) | null>(null)
  handleKeyDownRef.current = (e: KeyboardEvent) => {
    if (!visible) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      e.stopPropagation()
      setSelectedIndex((prev) => (prev + 1) % filtered.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      e.stopPropagation()
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length)
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault()
      e.stopPropagation()
      if (filtered[selectedIndex]) {
        onSelect(filtered[selectedIndex])
      }
    } else if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  // Attach/detach keydown listener
  // biome-ignore lint/correctness/useExhaustiveDependencies: ref-based handler
  useMemo(() => {
    if (typeof document === "undefined") return
    const handler = (e: KeyboardEvent) => handleKeyDownRef.current?.(e)
    if (visible) {
      document.addEventListener("keydown", handler, true)
      return () => document.removeEventListener("keydown", handler, true)
    }
  }, [visible])

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

// ─── Main component ─────────────────────────────────────────────────────────

export function WorkspaceChatInput() {
  const { workspaceId, resources } = useWorkbench()
  const navigate = useNavigate()
  const createResource = useCreateResource(workspaceId)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

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
      const textBeforeCursor = value.slice(0, cursorPos)
      const lastAtIndex = textBeforeCursor.lastIndexOf("@")

      if (lastAtIndex >= 0) {
        const charBefore = lastAtIndex > 0 ? value[lastAtIndex - 1] : " "
        const query = textBeforeCursor.slice(lastAtIndex + 1)
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

  // ─── Submit ─────────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    async (message: { text: string; files: FileUIPart[] }) => {
      const text = message.text.trim()
      if (!text && message.files.length === 0) return
      if (isSubmitting) return

      setIsSubmitting(true)
      try {
        const name =
          text.length > 60 ? text.slice(0, 57) + "..." : text || "New Chat"
        const resource = await createResource.mutateAsync({
          name,
          resourceType: "agent_session",
        })
        navigate(`/w/${workspaceId}/files/${resource.id}/`, {
          state: { initialMessage: text, initialFiles: message.files },
        })
      } finally {
        setIsSubmitting(false)
      }
    },
    [isSubmitting, createResource, workspaceId, navigate]
  )

  return (
    <div className="relative">
      <MentionPopover
        query={mentionQuery}
        items={mentionItems}
        onSelect={handleMentionSelect}
        onClose={() => setMentionVisible(false)}
        visible={mentionVisible}
      />
      <PromptInput
        onSubmit={handleSubmit}
        accept="image/*,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/json,text/plain"
        multiple
        className={isSubmitting ? "pointer-events-none opacity-60" : ""}
      >
        <PromptInputAttachments>
          {(attachment) => <PromptInputAttachment data={attachment} />}
        </PromptInputAttachments>
        <PromptInputTextarea
          ref={textareaRef}
          placeholder="Ask anything about your workspace... (@ to mention resources)"
          disabled={isSubmitting}
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

                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                  window.HTMLTextAreaElement.prototype,
                  "value"
                )?.set
                nativeInputValueSetter?.call(textarea, newValue)
                textarea.dispatchEvent(new Event("input", { bubbles: true }))

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
          <PromptInputSubmit disabled={isSubmitting} />
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}
