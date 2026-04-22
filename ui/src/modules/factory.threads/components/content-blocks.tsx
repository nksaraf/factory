import { useState } from "react"
import { cn } from "@rio.js/ui"
import { Icon } from "@rio.js/ui/icon"
import type { ContentBlock } from "../data/types"
import { Markdown } from "./markdown"
import { toolIcon, summarizeToolInput } from "./thread-helpers"

export function ContentBlockRenderer({
  block,
  defaultExpanded,
  cwd,
}: {
  block: ContentBlock
  defaultExpanded?: boolean
  cwd?: string
}) {
  switch (block.type) {
    case "text":
      return <TextBlockRenderer text={block.text} />
    case "thinking":
      return <ThinkingBlockRenderer text={block.thinking} />
    case "tool_use":
      return (
        <ToolUseBlockRenderer
          id={block.id}
          name={block.name}
          input={block.input}
          defaultExpanded={defaultExpanded}
          cwd={cwd}
        />
      )
    case "tool_result":
      return (
        <ToolResultBlockRenderer
          toolUseId={block.tool_use_id}
          content={block.content}
          isError={block.is_error}
          defaultExpanded={defaultExpanded}
        />
      )
    case "image":
      return <ImageBlockRenderer source={block.source} />
    case "redacted_thinking":
      return <RedactedThinkingRenderer />
    case "document":
      return <DocumentBlockRenderer source={block.source} title={block.title} />
    default:
      return (
        <div className="rounded border border-dashed border-muted-foreground/30 px-3 py-2 text-xs text-muted-foreground">
          Unknown block type:{" "}
          {(block as Record<string, unknown>).type as string}
        </div>
      )
  }
}

function TextBlockRenderer({ text }: { text: string }) {
  if (!text.trim()) return null
  return <Markdown text={text} />
}

function ThinkingBlockRenderer({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const preview = text.slice(0, 120).replace(/\n/g, " ")
  return (
    <div
      className="group cursor-pointer rounded border border-dashed border-muted-foreground/20 bg-muted/30 px-3 py-2"
      onClick={() => setOpen(!open)}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon
          icon="icon-[ph--brain-duotone]"
          className="h-3.5 w-3.5 shrink-0"
        />
        <span className="font-medium">Thinking</span>
        <Icon
          icon={open ? "icon-[ph--caret-up]" : "icon-[ph--caret-down]"}
          className="ml-auto h-3 w-3"
        />
      </div>
      {open ? (
        <div className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground/80 italic">
          {text}
        </div>
      ) : (
        <div className="mt-1 truncate text-xs text-muted-foreground/60 italic">
          {preview}
          {text.length > 120 && "..."}
        </div>
      )}
    </div>
  )
}

function ToolUseBlockRenderer({
  name,
  input,
  defaultExpanded,
  cwd,
}: {
  id?: string
  name: string
  input: Record<string, unknown>
  defaultExpanded?: boolean
  cwd?: string
}) {
  const [open, setOpen] = useState(defaultExpanded ?? false)
  const icon = toolIcon(name)
  const summary = summarizeToolInput(name, JSON.stringify(input), cwd)

  return (
    <div
      className="cursor-pointer rounded border border-violet-700/30 bg-violet-50/50 dark:bg-violet-950/10 px-3 py-2"
      onClick={() => setOpen(!open)}
    >
      <div className="flex items-center gap-2 text-sm">
        <Icon
          icon={icon}
          className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400"
        />
        <span className="font-medium text-violet-700 dark:text-violet-300">
          {name}
        </span>
        {summary && (
          <span className="truncate text-xs text-muted-foreground">
            {summary}
          </span>
        )}
        <Icon
          icon={open ? "icon-[ph--caret-up]" : "icon-[ph--caret-down]"}
          className="ml-auto h-3 w-3 text-muted-foreground"
        />
      </div>
      {open && (
        <pre className="mt-2 max-h-80 overflow-auto rounded bg-muted/50 p-2 text-xs">
          {JSON.stringify(input, null, 2)}
        </pre>
      )}
    </div>
  )
}

function ToolResultBlockRenderer({
  content,
  isError,
  defaultExpanded,
}: {
  toolUseId?: string
  content: string | ContentBlock[]
  isError?: boolean
  defaultExpanded?: boolean
}) {
  const [open, setOpen] = useState(defaultExpanded ?? false)
  const isString = typeof content === "string"
  const preview = isString
    ? content.slice(0, 150).replace(/\n/g, " ")
    : `[${(content as ContentBlock[]).length} blocks]`
  const hasNestedImage =
    !isString &&
    Array.isArray(content) &&
    content.some((b) => (b as ContentBlock).type === "image")

  return (
    <div
      className={cn(
        "cursor-pointer rounded border px-3 py-2",
        isError
          ? "border-red-700/30 bg-red-50/50 dark:bg-red-950/10"
          : "border-emerald-700/20 bg-emerald-50/30 dark:bg-emerald-950/5"
      )}
      onClick={() => setOpen(!open)}
    >
      <div className="flex items-center gap-2 text-xs">
        <Icon
          icon={
            isError
              ? "icon-[ph--x-circle-duotone]"
              : "icon-[ph--check-circle-duotone]"
          }
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            isError ? "text-red-500" : "text-emerald-500"
          )}
        />
        <span
          className={cn(
            "font-medium",
            isError
              ? "text-red-600 dark:text-red-400"
              : "text-emerald-600 dark:text-emerald-400"
          )}
        >
          {isError ? "Error" : "Result"}
        </span>
        {!open && (
          <span className="truncate text-muted-foreground">{preview}</span>
        )}
        <Icon
          icon={open ? "icon-[ph--caret-up]" : "icon-[ph--caret-down]"}
          className="ml-auto h-3 w-3 text-muted-foreground"
        />
      </div>
      {open && (
        <div className="mt-2">
          {isString ? (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs">
              {content}
            </pre>
          ) : (
            <div className="space-y-2">
              {(content as ContentBlock[]).map((block, i) => (
                <ContentBlockRenderer key={i} block={block} />
              ))}
            </div>
          )}
        </div>
      )}
      {!open && hasNestedImage && (
        <div className="mt-1 text-xs text-muted-foreground italic">
          Contains image(s)
        </div>
      )}
    </div>
  )
}

function ImageBlockRenderer({
  source,
}: {
  source: { type: string; media_type: string; data: string }
}) {
  if (source.type === "base64") {
    return (
      <div className="my-2">
        <img
          src={`data:${source.media_type};base64,${source.data}`}
          alt="Attached image"
          className="max-h-96 rounded border"
        />
      </div>
    )
  }
  if (source.type === "url") {
    return (
      <div className="my-2">
        <img
          src={source.data}
          alt="Attached image"
          className="max-h-96 rounded border"
        />
      </div>
    )
  }
  return (
    <div className="text-xs text-muted-foreground">Image ({source.type})</div>
  )
}

function RedactedThinkingRenderer() {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
      <Icon icon="icon-[ph--lock-duotone]" className="h-3 w-3" />
      <span>redacted thinking</span>
    </div>
  )
}

function DocumentBlockRenderer({
  source,
  title,
}: {
  source: Record<string, unknown>
  title?: string
}) {
  return (
    <div className="rounded border border-dashed border-muted-foreground/30 px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon icon="icon-[ph--file-duotone]" className="h-3.5 w-3.5" />
        <span>{title ?? "Document"}</span>
        <span className="text-muted-foreground/50">
          ({String(source.media_type ?? source.type ?? "unknown")})
        </span>
      </div>
    </div>
  )
}
