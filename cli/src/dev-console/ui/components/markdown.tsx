import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "../lib/cn.js"

export type MarkdownVariant = "default" | "user" | "assistant"

const VARIANT_FONT: Record<MarkdownVariant, string> = {
  default: "font-sans",
  user: "font-sans prose-p:font-medium prose-p:text-zinc-100",
  assistant: "font-sans prose-p:font-normal",
}

export function Markdown({
  text,
  className,
  compact = false,
  variant = "default",
}: {
  text: string
  className?: string
  compact?: boolean
  variant?: MarkdownVariant
}) {
  return (
    <div
      className={cn(
        "prose prose-invert prose-zinc max-w-none",
        VARIANT_FONT[variant],
        "prose-p:text-zinc-200 prose-p:leading-relaxed",
        "prose-headings:text-zinc-50 prose-headings:font-semibold prose-headings:tracking-tight",
        "prose-h1:text-xl prose-h2:text-lg prose-h3:text-base prose-h4:text-sm",
        "prose-strong:text-zinc-100",
        "prose-a:text-sky-300 prose-a:no-underline hover:prose-a:underline",
        "prose-code:text-violet-200 prose-code:bg-violet-950/40 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.85em] prose-code:font-mono prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:bg-zinc-950/70 prose-pre:border prose-pre:border-zinc-800/60 prose-pre:rounded-lg prose-pre:font-mono",
        "prose-blockquote:border-l-sky-500/40 prose-blockquote:text-zinc-300 prose-blockquote:not-italic",
        "prose-hr:border-zinc-800",
        "prose-li:text-zinc-200 prose-li:marker:text-zinc-600",
        "prose-table:text-sm prose-th:text-zinc-300 prose-td:text-zinc-300",
        compact && "prose-sm prose-p:my-1 prose-ul:my-1 prose-ol:my-1",
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}
