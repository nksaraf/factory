import { useMemo, useState } from "react"

import type { ThreadTurn } from "../api-client.js"
import { cn } from "../lib/cn.js"
import type { PlanEntry } from "./plan-drawer.js"

interface FileEntry {
  path: string
  count: number
  lastTurnId: string
  lastInput: string | null
  kind: "read" | "write"
}

interface ToolCall {
  name: string
  input: string | undefined
  turnId: string
}

function collectToolCalls(turns: ThreadTurn[]): ToolCall[] {
  const out: ToolCall[] = []
  for (const t of turns) {
    if (t.role === "tool" && t.spec.toolName) {
      out.push({
        name: t.spec.toolName,
        input: t.spec.toolInput,
        turnId: t.id,
      })
    }
    const inline = Array.isArray(t.spec.toolCalls) ? t.spec.toolCalls : []
    for (const c of inline) {
      if (c?.name) out.push({ name: c.name, input: c.input, turnId: t.id })
    }
  }
  return out
}

function extractFilePath(input: string | undefined): string | null {
  if (!input) return null
  try {
    const parsed = JSON.parse(input) as Record<string, unknown>
    const fp = parsed.file_path ?? parsed.path ?? parsed.notebook_path
    return typeof fp === "string" ? fp : null
  } catch {
    return null
  }
}

function collectFiles(calls: ToolCall[]): {
  written: FileEntry[]
  read: FileEntry[]
} {
  const written = new Map<string, FileEntry>()
  const read = new Map<string, FileEntry>()
  for (const c of calls) {
    const name = c.name.toLowerCase()
    const isWrite =
      name === "write" ||
      name === "edit" ||
      name === "multiedit" ||
      name === "notebookedit"
    const isRead = name === "read"
    if (!isWrite && !isRead) continue
    const path = extractFilePath(c.input)
    if (!path) continue
    const map = isWrite ? written : read
    const prev = map.get(path)
    if (prev) {
      prev.count++
      prev.lastTurnId = c.turnId
      prev.lastInput = c.input ?? null
    } else {
      map.set(path, {
        path,
        count: 1,
        lastTurnId: c.turnId,
        lastInput: c.input ?? null,
        kind: isWrite ? "write" : "read",
      })
    }
  }
  const sort = (a: FileEntry, b: FileEntry) => b.count - a.count
  return {
    written: [...written.values()].sort(sort),
    read: [...read.values()].sort(sort),
  }
}

function shortenPath(p: string, projectRoot?: string | null): string {
  if (projectRoot && p.startsWith(projectRoot + "/")) {
    return p.slice(projectRoot.length + 1)
  }
  return p
}

export function ThreadContextPanel({
  turns,
  plans,
  onOpenPlan,
  onJumpToTurn,
  onClose,
  projectRoot,
}: {
  turns: ThreadTurn[]
  plans: PlanEntry[]
  onOpenPlan: (slug: string) => void
  onJumpToTurn: (turnId: string) => void
  onClose: () => void
  projectRoot?: string | null
}) {
  const calls = useMemo(() => collectToolCalls(turns), [turns])
  const { written, read } = useMemo(() => collectFiles(calls), [calls])

  return (
    <aside className="rounded-xl border border-zinc-800/60 bg-zinc-950/40 flex flex-col overflow-hidden h-full">
      <header className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/60 shrink-0">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 flex items-center gap-2">
          <span className="icon-[ph--sidebar-simple-duotone] text-[13px]" />
          Context
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Hide panel"
          className="h-6 w-6 rounded-md border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900 text-zinc-500 hover:text-zinc-200 flex items-center justify-center"
        >
          <span className="icon-[ph--x-bold] text-[11px]" />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/60">
        <Section
          icon="icon-[ph--scroll-duotone] text-amber-300/80"
          label="Plans"
          count={plans.length}
          defaultOpen
          empty="No plans in this thread."
        >
          <ul className="space-y-1">
            {plans.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onOpenPlan(p.slug)}
                  className="group w-full text-left flex items-start gap-2 px-2 py-1.5 rounded-md border border-zinc-800/60 hover:border-amber-500/40 hover:bg-amber-500/5"
                >
                  <span className="icon-[ph--scroll-duotone] text-[12px] text-amber-300/70 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-zinc-200 truncate group-hover:text-amber-100">
                      {p.title}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-600 font-mono">
                      {p.version != null && <span>v{p.version}</span>}
                      {p.editCount ? <span>· {p.editCount} edits</span> : null}
                      {p.turnIndex != null && <span>· #{p.turnIndex}</span>}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Section>
        <Section
          icon="icon-[ph--pencil-duotone] text-sky-300/80"
          label="Written"
          count={written.length}
          defaultOpen={written.length > 0 && written.length <= 12}
          empty="No files written."
        >
          <FileList
            files={written}
            onJumpToTurn={onJumpToTurn}
            projectRoot={projectRoot}
          />
        </Section>
        <Section
          icon="icon-[ph--eye-duotone] text-zinc-400"
          label="Read"
          count={read.length}
          empty="No files read."
        >
          <FileList
            files={read}
            onJumpToTurn={onJumpToTurn}
            projectRoot={projectRoot}
          />
        </Section>
      </div>
    </aside>
  )
}

function Section({
  icon,
  label,
  count,
  empty,
  defaultOpen = false,
  children,
}: {
  icon: string
  label: string
  count: number
  empty: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-zinc-900/40"
      >
        <span className="flex items-center gap-2">
          <span className={`${icon} text-[13px]`} />
          <span className="font-semibold text-zinc-300 uppercase tracking-wider text-[10px]">
            {label}
          </span>
          <span className="text-[10px] font-mono text-zinc-600">{count}</span>
        </span>
        <span
          className={cn(
            "icon-[ph--caret-right-bold] text-[10px] text-zinc-500 transition-transform",
            open && "rotate-90"
          )}
        />
      </button>
      {open && (
        <div className="px-2 pb-3">
          {count === 0 ? (
            <div className="text-[11px] text-zinc-600 italic px-1 py-1">
              {empty}
            </div>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  )
}

function FileList({
  files,
  onJumpToTurn,
  projectRoot,
}: {
  files: FileEntry[]
  onJumpToTurn: (turnId: string) => void
  projectRoot?: string | null
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  return (
    <ul className="space-y-0.5">
      {files.map((f) => {
        const isOpen = expanded === f.path
        const short = shortenPath(f.path, projectRoot)
        const base = short.split("/").pop() ?? short
        const dir = short.slice(0, short.length - base.length)
        return (
          <li key={f.path}>
            <div
              className={cn(
                "group flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] hover:bg-zinc-900/60",
                isOpen && "bg-zinc-900/60"
              )}
            >
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : f.path)}
                className="flex-1 min-w-0 text-left"
                title={f.path}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="truncate">
                    {dir && <span className="text-zinc-600">{dir}</span>}
                    <span className="text-zinc-200">{base}</span>
                  </span>
                  {f.count > 1 && (
                    <span className="shrink-0 font-mono text-[9px] text-zinc-600">
                      ×{f.count}
                    </span>
                  )}
                </div>
              </button>
              <button
                type="button"
                onClick={() => onJumpToTurn(f.lastTurnId)}
                title="Jump to last turn"
                className="shrink-0 opacity-0 group-hover:opacity-100 h-5 w-5 rounded border border-zinc-800 hover:border-sky-600 hover:bg-sky-950/40 text-zinc-500 hover:text-sky-300 flex items-center justify-center"
              >
                <span className="icon-[ph--arrow-right-bold] text-[9px]" />
              </button>
            </div>
            {isOpen && f.lastInput && (
              <ToolInputPreview input={f.lastInput} kind={f.kind} />
            )}
          </li>
        )
      })}
    </ul>
  )
}

function ToolInputPreview({
  input,
  kind,
}: {
  input: string
  kind: "read" | "write"
}) {
  let parsed: Record<string, unknown> | null = null
  try {
    parsed = JSON.parse(input) as Record<string, unknown>
  } catch {
    return (
      <pre className="mt-1 ml-4 mr-1 text-[10px] text-zinc-400 bg-zinc-950/60 border border-zinc-800/60 rounded p-2 whitespace-pre-wrap break-words max-h-48 overflow-auto font-mono">
        {input.slice(0, 2000)}
      </pre>
    )
  }
  const oldStr =
    typeof parsed.old_string === "string" ? parsed.old_string : null
  const newStr =
    typeof parsed.new_string === "string" ? parsed.new_string : null
  const content = typeof parsed.content === "string" ? parsed.content : null
  const edits = Array.isArray(parsed.edits) ? parsed.edits : null

  return (
    <div className="mt-1 ml-4 mr-1 space-y-1 text-[10px] font-mono max-h-64 overflow-auto">
      {oldStr != null && newStr != null && (
        <DiffBlock oldStr={oldStr} newStr={newStr} />
      )}
      {edits?.map((e, i) => {
        const o = e as Record<string, unknown>
        const os = typeof o.old_string === "string" ? o.old_string : ""
        const ns = typeof o.new_string === "string" ? o.new_string : ""
        return <DiffBlock key={i} oldStr={os} newStr={ns} />
      })}
      {content != null && (
        <pre className="text-zinc-300 bg-zinc-950/60 border border-zinc-800/60 rounded p-2 whitespace-pre-wrap break-words">
          {content.slice(0, 2000)}
          {content.length > 2000 && "\n…"}
        </pre>
      )}
      {kind === "read" && !content && !oldStr && !edits && (
        <pre className="text-zinc-500 bg-zinc-950/60 border border-zinc-800/60 rounded p-2">
          {JSON.stringify(parsed, null, 2).slice(0, 600)}
        </pre>
      )}
    </div>
  )
}

function DiffBlock({ oldStr, newStr }: { oldStr: string; newStr: string }) {
  return (
    <div className="border border-zinc-800/60 rounded overflow-hidden">
      {oldStr && (
        <pre className="bg-red-950/30 text-red-200/90 px-2 py-1 whitespace-pre-wrap break-words border-b border-zinc-800/60">
          {oldStr.slice(0, 1500)}
          {oldStr.length > 1500 && "\n…"}
        </pre>
      )}
      {newStr && (
        <pre className="bg-emerald-950/30 text-emerald-200/90 px-2 py-1 whitespace-pre-wrap break-words">
          {newStr.slice(0, 1500)}
          {newStr.length > 1500 && "\n…"}
        </pre>
      )}
    </div>
  )
}
