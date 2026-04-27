import { useMemo, useState } from "react"

import { cn } from "@rio.js/ui/lib/utils"
import { Icon } from "@rio.js/ui/icon"

import type { ThreadTurn } from "../data/types"
import type { PlanEntry } from "../data/types"

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
      out.push({ name: t.spec.toolName, input: t.spec.toolInput, turnId: t.id })
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
  if (projectRoot && p.startsWith(projectRoot + "/"))
    return p.slice(projectRoot.length + 1)
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
    <aside className="rounded-xl border bg-card flex flex-col overflow-hidden h-full">
      <header className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Icon icon="icon-[ph--sidebar-simple-duotone]" className="text-sm" />
          Context
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Hide panel"
          className="h-6 w-6 rounded-md border hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center"
        >
          <Icon icon="icon-[ph--x-bold]" className="text-xs" />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto divide-y">
        <Section
          icon="icon-[ph--scroll-duotone] text-amber-500"
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
                  className="group w-full text-left flex items-start gap-2 px-2 py-1.5 rounded-md border border-transparent hover:border-amber-500/30 hover:bg-amber-500/5"
                >
                  <Icon
                    icon="icon-[ph--scroll-duotone]"
                    className="text-xs text-amber-500/70 mt-0.5 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-foreground truncate group-hover:text-amber-700 dark:group-hover:text-amber-300 flex-1 min-w-0">
                        {p.title}
                      </span>
                      {p.referenced && !p.authored && (
                        <span
                          title="Referenced by tool calls in this thread; authored elsewhere"
                          className="shrink-0 text-xs uppercase tracking-wide px-1 py-0.5 rounded border border-sky-500/30 bg-sky-500/5 text-sky-600 dark:text-sky-400"
                        >
                          ref
                        </span>
                      )}
                      {p.authored && (
                        <span
                          title="Authored in this thread"
                          className="shrink-0 text-xs uppercase tracking-wide px-1 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
                        >
                          here
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground font-mono">
                      {p.version != null && <span>v{p.version}</span>}
                      {p.editCount ? (
                        <span>&middot; {p.editCount} edits</span>
                      ) : null}
                      {p.turnIndex != null && (
                        <span>&middot; #{p.turnIndex}</span>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Section>
        <Section
          icon="icon-[ph--pencil-duotone] text-sky-500"
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
          icon="icon-[ph--eye-duotone] text-muted-foreground"
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
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-accent/50"
      >
        <span className="flex items-center gap-2">
          <span className={`${icon} text-sm`} />
          <span className="font-semibold text-foreground/80 uppercase tracking-wider text-xs">
            {label}
          </span>
          <span className="text-xs font-mono text-muted-foreground">
            {count}
          </span>
        </span>
        <span
          className={cn(
            "icon-[ph--caret-right-bold] text-xs text-muted-foreground transition-transform",
            open && "rotate-90"
          )}
        />
      </button>
      {open && (
        <div className="px-2 pb-3">
          {count === 0 ? (
            <div className="text-xs text-muted-foreground italic px-1 py-1">
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
                "group flex items-center gap-1.5 rounded px-1.5 py-1 text-sm hover:bg-accent/50",
                isOpen && "bg-accent/50"
              )}
            >
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : f.path)}
                className="flex-1 min-w-0 text-left"
                title={f.path}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="truncate text-xs">
                    {dir && (
                      <span className="text-muted-foreground">{dir}</span>
                    )}
                    <span className="text-foreground">{base}</span>
                  </span>
                  {f.count > 1 && (
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      &times;{f.count}
                    </span>
                  )}
                </div>
              </button>
              <button
                type="button"
                onClick={() => onJumpToTurn(f.lastTurnId)}
                title="Jump to last turn"
                className="shrink-0 opacity-0 group-hover:opacity-100 h-5 w-5 rounded border hover:border-primary hover:bg-primary/10 text-muted-foreground hover:text-primary flex items-center justify-center"
              >
                <Icon icon="icon-[ph--arrow-right-bold]" className="text-xs" />
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
