import { PreviewCard } from "@base-ui-components/react/preview-card"

import { Markdown } from "./markdown.js"

interface Segment {
  kind: "text" | "system"
  tag?: string
  content: string
}

const SYSTEM_TAG_RE =
  /<(system[_-]instruction|system_prompt|system|context|workspace_context)>([\s\S]*?)<\/\1>/g

function parseMessage(text: string): Segment[] {
  const segs: Segment[] = []
  let lastIndex = 0
  SYSTEM_TAG_RE.lastIndex = 0
  const matches = text.matchAll(SYSTEM_TAG_RE)
  for (const m of matches) {
    const idx = m.index ?? 0
    if (idx > lastIndex) {
      segs.push({ kind: "text", content: text.slice(lastIndex, idx) })
    }
    segs.push({ kind: "system", tag: m[1], content: m[2] ?? "" })
    lastIndex = idx + m[0].length
  }
  if (lastIndex < text.length) {
    segs.push({ kind: "text", content: text.slice(lastIndex) })
  }
  return segs.length > 0 ? segs : [{ kind: "text", content: text }]
}

function SystemBadge({ tag, content }: { tag: string; content: string }) {
  const lines = content.trim().split("\n").length
  const chars = content.length
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 align-middle mx-0.5 px-2 py-0.5 rounded-md border border-zinc-700/60 bg-zinc-800/60 text-[11px] text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 hover:bg-zinc-800 transition-colors font-mono"
          />
        }
      >
        <span className="icon-[ph--gear-duotone] text-[12px] text-zinc-500" />
        {tag}
        <span className="text-[10px] text-zinc-600">
          · {lines}L · {chars}ch
        </span>
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner sideOffset={8} side="top" align="start">
          <PreviewCard.Popup className="origin-[var(--transform-origin)] transition-[transform,opacity] duration-150 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 max-w-2xl min-w-[320px] rounded-lg border border-zinc-800 bg-zinc-950/95 backdrop-blur-md shadow-2xl shadow-black/60 overflow-hidden">
            <div className="px-3 py-2 border-b border-zinc-800/60 flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
              <span className="icon-[ph--gear-duotone] text-[13px]" />
              <span className="font-mono normal-case text-zinc-400">
                {`<${tag}>`}
              </span>
              <span className="ml-auto text-zinc-600 normal-case">
                {lines} lines · {chars} chars
              </span>
            </div>
            <pre className="px-3 py-2 text-[11px] font-mono text-zinc-300 whitespace-pre-wrap break-words max-h-80 overflow-y-auto leading-relaxed">
              {content.trim()}
            </pre>
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  )
}

export function UserMessage({ text }: { text: string }) {
  const segs = parseMessage(text)
  return (
    <div className="space-y-1">
      {segs.map((s, i) => {
        if (s.kind === "system") {
          return <SystemBadge key={i} tag={s.tag!} content={s.content} />
        }
        const trimmed = s.content.trim()
        if (!trimmed) return null
        return <Markdown key={i} text={trimmed} variant="user" />
      })}
    </div>
  )
}
