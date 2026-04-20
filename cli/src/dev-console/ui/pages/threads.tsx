import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router"

import type {
  Thread,
  ThreadChannel,
  ThreadPlan,
  ThreadTurn,
} from "../api-client.js"
import {
  useChannelThreads,
  useThreadChannels,
  useThreadPlans,
  useThreadTurns,
} from "../hooks/use-queries.js"
import { Select } from "@base-ui-components/react/select"

import { Markdown } from "../components/markdown.js"
import { PlanDrawer, type PlanEntry } from "../components/plan-drawer.js"
import { ThreadContextPanel } from "../components/thread-context-panel.js"
import { UserMessage } from "../components/user-message.js"
import { useLocation as useDxLocation } from "../hooks/use-queries.js"

const SOURCE_ICON: Record<string, string> = {
  "claude-code": "icon-[simple-icons--claude]",
  cursor: "icon-[simple-icons--cursor]",
  conductor: "icon-[ph--music-notes-duotone]",
  slack: "icon-[simple-icons--slack]",
  terminal: "icon-[ph--terminal-window-duotone]",
  web: "icon-[ph--globe-duotone]",
}

const ROLE_STYLE: Record<string, string> = {
  user: "border-sky-700/40 bg-sky-950/20",
  assistant: "border-zinc-800 bg-zinc-900/40",
  system: "border-amber-800/50 bg-amber-950/10",
  tool: "border-violet-800/50 bg-violet-950/10",
  thinking: "border-zinc-800 bg-zinc-950/40 italic",
  subagent: "border-emerald-800/50 bg-emerald-950/10",
}

const ROLE_ICON: Record<string, string> = {
  user: "icon-[ph--user-duotone]",
  assistant: "icon-[simple-icons--claude]",
  system: "icon-[ph--gear-duotone]",
  tool: "icon-[ph--wrench-duotone]",
  thinking: "icon-[ph--brain-duotone]",
  subagent: "icon-[ph--robot-duotone]",
}

const TOOL_ICON: Record<string, string> = {
  bash: "icon-[ph--terminal-duotone]",
  read: "icon-[ph--file-text-duotone]",
  edit: "icon-[ph--pencil-simple-duotone]",
  write: "icon-[ph--file-plus-duotone]",
  glob: "icon-[ph--funnel-duotone]",
  grep: "icon-[ph--magnifying-glass-duotone]",
  webfetch: "icon-[ph--globe-duotone]",
  websearch: "icon-[ph--magnifying-glass-duotone]",
  task: "icon-[ph--robot-duotone]",
  todowrite: "icon-[ph--check-square-duotone]",
}

function toolIcon(name: string | undefined): string {
  if (!name) return "icon-[ph--wrench-duotone]"
  return TOOL_ICON[name.toLowerCase()] ?? "icon-[ph--wrench-duotone]"
}

function formatDuration(start: string, end?: string | null): string {
  const a = new Date(start).getTime()
  const b = end ? new Date(end).getTime() : Date.now()
  const sec = Math.max(0, Math.floor((b - a) / 1000))
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  return `${hr}h ${min % 60}m`
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function formatTokens(n?: number): string {
  if (!n) return "0"
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "active"
      ? "bg-emerald-500/10 text-emerald-400 border-emerald-700/50"
      : status === "completed"
        ? "bg-zinc-700/40 text-zinc-300 border-zinc-700"
        : status === "failed"
          ? "bg-red-500/10 text-red-400 border-red-700/50"
          : "bg-zinc-800 text-zinc-500 border-zinc-700"
  return (
    <span
      className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${cls}`}
    >
      {status}
    </span>
  )
}

function ThreadListItem({
  thread,
  selected,
  onClick,
}: {
  thread: Thread
  selected: boolean
  onClick: () => void
}) {
  const rawTitle =
    thread.title ||
    thread.spec.generatedTopic ||
    thread.spec.title ||
    thread.spec.firstPrompt ||
    thread.spec.lastPrompt ||
    ""
  const title = rawTitle
    ? rawTitle.split("\n")[0]!.slice(0, 120)
    : `${thread.source} session`
  const dotColor =
    thread.status === "active"
      ? "bg-emerald-500"
      : thread.status === "failed"
        ? "bg-red-500"
        : "bg-zinc-600"
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`w-full text-left px-2 py-1 border-l-2 flex items-center gap-2 transition-colors ${
        selected
          ? "border-sky-500 bg-zinc-900/70"
          : "border-transparent hover:bg-zinc-900/40"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColor}`}
        aria-hidden
      />
      <span
        className={`${SOURCE_ICON[thread.source] ?? "icon-[ph--chat-circle-duotone]"} text-[14px] text-zinc-500 shrink-0`}
        aria-hidden
      />
      <span
        className={`text-xs truncate flex-1 ${selected ? "text-zinc-100" : "text-zinc-300"}`}
      >
        {title}
      </span>
      <span className="text-[10px] text-zinc-600 shrink-0 tabular-nums">
        {relativeTime(thread.startedAt)}
      </span>
    </button>
  )
}

function ToolCallChip({
  name,
  input,
  failed,
  onOpenPlan,
}: {
  name: string
  input?: string
  failed?: boolean
  onOpenPlan?: (slug: string) => void
}) {
  const [open, setOpen] = useState(false)
  const summary = summarizeToolInput(name, input)
  const planSlug = detectPlanSlug(name, input)
  return (
    <div
      className={`text-[11px] font-mono border-l-2 ${
        failed
          ? "border-red-800/60"
          : planSlug
            ? "border-amber-700/50"
            : "border-transparent"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-0.5 text-left hover:bg-zinc-900/40 text-zinc-500 hover:text-zinc-300"
      >
        <span className="text-zinc-700">{open ? "▾" : "▸"}</span>
        <span
          className={`${planSlug ? "icon-[ph--scroll-duotone]" : toolIcon(name)} text-[13px] ${
            failed
              ? "text-red-400"
              : planSlug
                ? "text-amber-300"
                : "text-violet-300/80"
          }`}
        />
        <span
          className={
            failed
              ? "text-red-300 font-semibold"
              : planSlug
                ? "text-amber-300 font-semibold"
                : "text-violet-300/80 font-semibold"
          }
        >
          {planSlug ? `${name} plan` : name}
        </span>
        <span className="truncate flex-1 text-zinc-600">{summary}</span>
        {planSlug && onOpenPlan && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              onOpenPlan(planSlug)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation()
                onOpenPlan(planSlug)
              }
            }}
            className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-800/60 bg-amber-950/40 text-amber-200 hover:bg-amber-900/50 hover:text-amber-100 text-[10px] normal-case tracking-normal cursor-pointer"
            title="Open plan"
          >
            <span className="icon-[ph--arrow-square-out] text-[11px]" />
            open
          </span>
        )}
      </button>
      {open && input && (
        <pre className="px-4 py-1.5 text-[10px] bg-zinc-950/60 rounded m-1 whitespace-pre-wrap break-all text-zinc-400">
          {input}
        </pre>
      )}
    </div>
  )
}

function planToEntry(
  p: ThreadPlan,
  turnsById: Map<string, ThreadTurn>
): PlanEntry {
  const turn = p.sourceTurnId ? turnsById.get(p.sourceTurnId) : undefined
  return {
    id: p.slug,
    slug: p.slug,
    title: p.title ?? p.slug,
    turnIndex: turn?.turnIndex,
    timestamp: p.updatedAt ?? undefined,
    version: p.latestVersion,
    editCount: p.editCount,
  }
}

function detectPlanSlug(
  toolName: string | undefined,
  input: string | undefined
): string | null {
  if (!input) return null
  const name = (toolName ?? "").toLowerCase()
  if (name !== "write" && name !== "edit" && name !== "read") return null
  let parsed: Record<string, unknown> | null = null
  try {
    parsed = JSON.parse(input) as Record<string, unknown>
  } catch {
    return null
  }
  const fp = parsed?.file_path
  if (typeof fp !== "string") return null
  // Match .claude/plans/<slug>.md, docs/superpowers/plans/<slug>.md, .context/plans/<slug>.md
  const m =
    fp.match(/\/\.claude\/plans\/([^/]+)\.md$/) ||
    fp.match(/\/docs\/superpowers\/plans\/([^/]+)\.md$/) ||
    fp.match(/\/\.context\/plans\/([^/]+)\.md$/)
  return m ? m[1]! : null
}

function summarizeToolInput(
  toolName: string | undefined,
  input: string | undefined
): string {
  if (!input) return ""
  let parsed: Record<string, unknown> | null = null
  try {
    parsed = JSON.parse(input) as Record<string, unknown>
  } catch {
    return input.slice(0, 160)
  }
  const name = (toolName ?? "").toLowerCase()
  const pick = (k: string): string | undefined => {
    const v = parsed?.[k]
    return typeof v === "string" ? v : undefined
  }
  if (name === "bash") {
    return pick("command") ?? pick("description") ?? ""
  }
  if (name === "read" || name === "edit" || name === "write") {
    return pick("file_path") ?? ""
  }
  if (name === "glob") return pick("pattern") ?? ""
  if (name === "grep") {
    const p = pick("pattern") ?? ""
    const path = pick("path")
    return path ? `${p}  ${path}` : p
  }
  if (name === "webfetch") return pick("url") ?? ""
  const first =
    pick("command") ??
    pick("description") ??
    pick("file_path") ??
    pick("pattern") ??
    pick("url") ??
    pick("prompt") ??
    ""
  return first || JSON.stringify(parsed).slice(0, 160)
}

function ToolTurnRow({
  turn,
  onOpenPlan,
}: {
  turn: ThreadTurn
  onOpenPlan?: (slug: string) => void
}) {
  const [open, setOpen] = useState(false)
  const name = turn.spec.toolName ?? "tool"
  const summary = summarizeToolInput(turn.spec.toolName, turn.spec.toolInput)
  const failed = !!turn.spec.failed
  const planSlug = detectPlanSlug(turn.spec.toolName, turn.spec.toolInput)
  return (
    <div
      id={`turn-${turn.id}`}
      className={`text-[11px] font-mono border-l-2 transition-shadow ${
        failed
          ? "border-red-800/60"
          : planSlug
            ? "border-amber-700/50"
            : "border-transparent"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-0.5 text-left hover:bg-zinc-900/40 text-zinc-500 hover:text-zinc-300"
      >
        <span className="text-zinc-700">{open ? "▾" : "▸"}</span>
        <span
          className={`${planSlug ? "icon-[ph--scroll-duotone]" : toolIcon(turn.spec.toolName)} text-[13px] ${
            failed
              ? "text-red-400"
              : planSlug
                ? "text-amber-300"
                : "text-violet-300/80"
          }`}
        />
        <span
          className={
            failed
              ? "text-red-300 font-semibold"
              : planSlug
                ? "text-amber-300 font-semibold"
                : "text-violet-300/80 font-semibold"
          }
        >
          {planSlug ? `${name} plan` : name}
        </span>
        <span className="truncate flex-1 text-zinc-600">{summary}</span>
        {planSlug && onOpenPlan && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              onOpenPlan(planSlug)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation()
                onOpenPlan(planSlug)
              }
            }}
            className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-800/60 bg-amber-950/40 text-amber-200 hover:bg-amber-900/50 hover:text-amber-100 text-[10px] normal-case tracking-normal cursor-pointer"
            title="Open plan"
          >
            <span className="icon-[ph--arrow-square-out] text-[11px]" />
            open
          </span>
        )}
        {turn.spec.timestamp && (
          <span className="text-zinc-700 text-[10px] shrink-0">
            {new Date(turn.spec.timestamp).toLocaleTimeString()}
          </span>
        )}
      </button>
      {open && (
        <div className="px-4 py-1.5 space-y-1.5 text-[10px]">
          {turn.spec.toolInput && (
            <pre className="bg-zinc-950/60 rounded p-2 whitespace-pre-wrap break-all text-zinc-400">
              {turn.spec.toolInput}
            </pre>
          )}
          {turn.spec.toolOutput && (
            <pre className="bg-zinc-950/60 rounded p-2 whitespace-pre-wrap break-all text-zinc-400 max-h-48 overflow-auto">
              {turn.spec.toolOutput}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function InlineToolCalls({
  calls,
  errors,
  onOpenPlan,
}: {
  calls: Array<{ name: string; input?: string }>
  errors: Array<{ toolName: string; error: string; errorClass: string }>
  onOpenPlan?: (slug: string) => void
}) {
  const [open, setOpen] = useState(false)
  const failedCount = calls.filter((c) =>
    errors.some((e) => e.toolName === c.name)
  ).length
  const planCount = calls.filter((c) => detectPlanSlug(c.name, c.input)).length
  return (
    <div className="mt-3 rounded border border-zinc-800/60 bg-zinc-950/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/30"
      >
        <span className="text-zinc-700">{open ? "▾" : "▸"}</span>
        <span>{calls.length} tool calls</span>
        {planCount > 0 && (
          <span className="text-amber-300/80 normal-case inline-flex items-center gap-1">
            · <span className="icon-[ph--scroll-duotone] text-[11px]" />{" "}
            {planCount} plan{planCount > 1 ? "s" : ""}
          </span>
        )}
        {failedCount > 0 && (
          <span className="text-red-400/80 normal-case">
            · {failedCount} failed
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-zinc-800/60 divide-y divide-zinc-900/60 py-0.5">
          {calls.map((tc, i) => {
            const failed = errors.some((e) => e.toolName === tc.name)
            return (
              <ToolCallChip
                key={`${tc.name}-${i}`}
                name={tc.name}
                input={tc.input}
                failed={failed}
                onOpenPlan={onOpenPlan}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function ToolGroup({
  turns,
  onOpenPlan,
}: {
  turns: ThreadTurn[]
  onOpenPlan?: (slug: string) => void
}) {
  const [open, setOpen] = useState(false)
  const failedCount = turns.filter((t) => t.spec.failed).length
  const planCount = turns.filter((t) =>
    detectPlanSlug(t.spec.toolName, t.spec.toolInput)
  ).length
  return (
    <div className="rounded border border-zinc-800/60 bg-zinc-950/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/30"
      >
        <span className="text-zinc-700">{open ? "▾" : "▸"}</span>
        <span>{turns.length} tool calls</span>
        {planCount > 0 && (
          <span className="text-amber-300/80 normal-case inline-flex items-center gap-1">
            · <span className="icon-[ph--scroll-duotone] text-[11px]" />{" "}
            {planCount} plan{planCount > 1 ? "s" : ""}
          </span>
        )}
        {failedCount > 0 && (
          <span className="text-red-400/80 normal-case">
            · {failedCount} failed
          </span>
        )}
        <span className="ml-auto text-zinc-700 normal-case">
          #{turns[0]!.turnIndex}–{turns[turns.length - 1]!.turnIndex}
        </span>
      </button>
      {open && (
        <div className="border-t border-zinc-800/60 divide-y divide-zinc-900/60 py-0.5">
          {turns.map((t) => (
            <ToolTurnRow key={t.id} turn={t} onOpenPlan={onOpenPlan} />
          ))}
        </div>
      )}
    </div>
  )
}

function TurnCard({
  turn,
  planSlug,
  onOpenPlan,
}: {
  turn: ThreadTurn
  planSlug?: string | null
  onOpenPlan?: (slug: string) => void
}) {
  const cls = ROLE_STYLE[turn.role] ?? "border-zinc-800 bg-zinc-900/30"
  const text =
    turn.spec.prompt ??
    turn.spec.responseSummary ??
    turn.spec.message ??
    turn.spec.command ??
    turn.spec.output ??
    turn.spec.toolOutput ??
    ""
  const tokens =
    (turn.spec.tokenUsage?.input ?? 0) + (turn.spec.tokenUsage?.output ?? 0)
  const isPlan = !!planSlug

  return (
    <article
      id={`turn-${turn.id}`}
      className={`rounded-lg border ${cls} ${isPlan ? "ring-1 ring-amber-700/30" : ""} p-4 transition-shadow`}
    >
      <header className="flex items-center gap-2 mb-2 text-xs">
        <span
          className={`${ROLE_ICON[turn.role] ?? "icon-[ph--chat-circle-duotone]"} text-[15px] ${
            turn.role === "user"
              ? "text-sky-300"
              : turn.role === "assistant"
                ? "text-orange-300"
                : turn.role === "subagent"
                  ? "text-emerald-300"
                  : "text-zinc-400"
          }`}
        />
        <span className="font-semibold uppercase tracking-wide text-zinc-300">
          {turn.role}
        </span>
        {isPlan && planSlug && (
          <button
            type="button"
            onClick={() => onOpenPlan?.(planSlug)}
            className="group inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border border-amber-700/50 bg-amber-950/30 text-amber-300 hover:bg-amber-900/40 hover:text-amber-200 transition-colors"
            title="Open plan in side panel"
          >
            <span className="icon-[ph--scroll-duotone] text-[11px]" />
            Plan
            <span className="icon-[ph--arrow-square-out] text-[11px] opacity-60 group-hover:opacity-100" />
          </button>
        )}
        {turn.spec.toolName && (
          <span className="font-mono text-violet-400">
            {turn.spec.toolName}
          </span>
        )}
        {turn.spec.failed && (
          <span className="text-red-400 text-[10px]">FAILED</span>
        )}
        <span className="text-[10px] text-zinc-600 ml-auto">
          #{turn.turnIndex}
          {turn.spec.timestamp &&
            ` · ${new Date(turn.spec.timestamp).toLocaleTimeString()}`}
        </span>
      </header>

      {turn.role === "user" && text && <UserMessage text={text} />}

      {turn.role === "assistant" && text && (
        <Markdown text={text} variant="assistant" />
      )}

      {text &&
        turn.role !== "user" &&
        turn.role !== "assistant" &&
        turn.role !== "tool" && (
          <div className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">
            {text}
          </div>
        )}

      {Array.isArray(turn.spec.toolCalls) && turn.spec.toolCalls.length > 0 && (
        <InlineToolCalls
          calls={turn.spec.toolCalls}
          errors={
            Array.isArray(turn.spec.toolErrors) ? turn.spec.toolErrors : []
          }
          onOpenPlan={onOpenPlan}
        />
      )}

      {tokens > 0 && (
        <footer className="mt-2 text-[10px] text-zinc-600 font-mono">
          in {formatTokens(turn.spec.tokenUsage?.input)} · out{" "}
          {formatTokens(turn.spec.tokenUsage?.output)}
          {turn.spec.tokenUsage?.cacheRead
            ? ` · cache ${formatTokens(turn.spec.tokenUsage.cacheRead)}`
            : ""}
          {turn.spec.model && ` · ${turn.spec.model}`}
        </footer>
      )}
    </article>
  )
}

function PlansSection({
  plans,
  onOpen,
}: {
  plans: PlanEntry[]
  onOpen: (slug: string) => void
}) {
  if (plans.length === 0) return null
  return (
    <div className="rounded-xl border border-amber-900/30 bg-gradient-to-br from-amber-950/30 to-zinc-950/40 p-3">
      <div className="flex items-center gap-2 mb-2 text-[10px] uppercase tracking-wider font-semibold text-amber-300/80">
        <span className="icon-[ph--scroll-duotone] text-[14px]" />
        Plans in this thread ({plans.length})
      </div>
      <div className="space-y-1">
        {plans.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onOpen(p.slug)}
            className="group w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md border border-transparent hover:border-amber-800/40 hover:bg-amber-950/30 text-left transition-colors"
          >
            <span className="icon-[ph--file-text-duotone] text-[14px] text-amber-400/70 group-hover:text-amber-300" />
            <span className="text-sm text-zinc-200 group-hover:text-zinc-50 truncate flex-1">
              {p.title}
            </span>
            {p.version != null && (
              <span className="text-[10px] font-mono text-zinc-600 shrink-0">
                v{p.version}
              </span>
            )}
            {p.turnIndex != null && (
              <span className="text-[10px] font-mono text-zinc-600 shrink-0">
                #{p.turnIndex}
              </span>
            )}
            <span className="icon-[ph--arrow-square-out] text-[12px] text-zinc-600 group-hover:text-amber-300" />
          </button>
        ))}
      </div>
    </div>
  )
}

function ThreadView({
  threadId,
  panelOpen,
  onClosePanel,
  projectRoot,
}: {
  threadId: string
  panelOpen: boolean
  onClosePanel: () => void
  projectRoot: string | null
}) {
  const turns = useThreadTurns(threadId)
  const threadPlans = useThreadPlans(threadId)
  const list = turns.data ?? []
  const [openPlanSlug, setOpenPlanSlug] = useState<string | null>(null)

  const jumpToTurn = (turnId: string) => {
    const el = document.getElementById(`turn-${turnId}`)
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" })
      el.classList.add("ring-2", "ring-sky-500/60")
      setTimeout(() => el.classList.remove("ring-2", "ring-sky-500/60"), 1800)
    }
  }

  const turnsById = useMemo(() => {
    const m = new Map<string, ThreadTurn>()
    for (const t of list) m.set(t.id, t)
    return m
  }, [list])

  const plans = useMemo<PlanEntry[]>(
    () => (threadPlans.data ?? []).map((p) => planToEntry(p, turnsById)),
    [threadPlans.data, turnsById]
  )

  const planByTurnId = useMemo(() => {
    const m = new Map<string, PlanEntry>()
    for (const raw of threadPlans.data ?? []) {
      if (raw.sourceTurnId) {
        m.set(raw.sourceTurnId, planToEntry(raw, turnsById))
      }
    }
    return m
  }, [threadPlans.data, turnsById])

  const openPlan = openPlanSlug
    ? (plans.find((p) => p.slug === openPlanSlug) ??
      ({
        id: openPlanSlug,
        slug: openPlanSlug,
        title: openPlanSlug,
      } as PlanEntry))
    : null

  useEffect(() => {
    setOpenPlanSlug(null)
  }, [threadId])

  if (turns.isLoading) {
    return <div className="text-sm text-zinc-500 p-6">Loading turns…</div>
  }
  if (list.length === 0) {
    return (
      <div className="text-sm text-zinc-500 p-6 rounded-lg border border-zinc-800 bg-zinc-900/20 text-center">
        No turns recorded yet.
      </div>
    )
  }
  const groups: Array<
    { kind: "turn"; turn: ThreadTurn } | { kind: "tools"; turns: ThreadTurn[] }
  > = []
  for (const t of list) {
    if (t.role === "tool") {
      const last = groups[groups.length - 1]
      if (last && last.kind === "tools") last.turns.push(t)
      else groups.push({ kind: "tools", turns: [t] })
    } else {
      groups.push({ kind: "turn", turn: t })
    }
  }

  return (
    <div className="flex gap-3 min-w-0 flex-1 min-h-0">
      <div className="space-y-3 flex-1 min-w-0 overflow-y-auto pr-2">
        <PlansSection plans={plans} onOpen={setOpenPlanSlug} />
        {groups.map((g, i) =>
          g.kind === "turn" ? (
            <TurnCard
              key={g.turn.id}
              turn={g.turn}
              planSlug={planByTurnId.get(g.turn.id)?.slug ?? null}
              onOpenPlan={setOpenPlanSlug}
            />
          ) : (
            <ToolGroup
              key={`tools-${i}`}
              turns={g.turns}
              onOpenPlan={setOpenPlanSlug}
            />
          )
        )}
      </div>
      {panelOpen && (
        <div className="w-80 shrink-0 h-full">
          <ThreadContextPanel
            turns={list}
            plans={plans}
            onOpenPlan={setOpenPlanSlug}
            onJumpToTurn={jumpToTurn}
            onClose={onClosePanel}
            projectRoot={projectRoot}
          />
        </div>
      )}
      <PlanDrawer
        plan={openPlan}
        onClose={() => setOpenPlanSlug(null)}
        onJumpToTurn={jumpToTurn}
      />
    </div>
  )
}

function channelLabel(c: ThreadChannel): string {
  return c.name?.trim() || c.externalId || c.id.slice(0, 10)
}

export function ThreadsPage() {
  const channels = useThreadChannels()
  const [params, setParams] = useSearchParams()
  const channelId = params.get("channel")
  const threadId = params.get("thread")
  const [filter, setFilter] = useState("")
  const [panelOpen, setPanelOpen] = useState(true)
  const locationQuery = useDxLocation()
  const projectRoot = locationQuery.data?.project?.rootDir ?? null

  const setChannelId = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set("channel", id)
    else next.delete("channel")
    next.delete("thread")
    setParams(next, { replace: false })
  }
  const setThreadId = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set("thread", id)
    else next.delete("thread")
    setParams(next, { replace: false })
  }

  useEffect(() => {
    if (!channelId && channels.data && channels.data.length > 0) {
      const next = new URLSearchParams(params)
      next.set("channel", channels.data[0]!.id)
      setParams(next, { replace: true })
    }
  }, [channels.data, channelId, params, setParams])

  const threads = useChannelThreads(channelId)
  const threadList = threads.data ?? []
  const filtered = useMemo(() => {
    if (!filter) return threadList
    const q = filter.toLowerCase()
    return threadList.filter((t) => {
      const title = (
        t.title ||
        t.spec.generatedTopic ||
        t.spec.title ||
        t.spec.firstPrompt ||
        ""
      ).toLowerCase()
      return (
        title.includes(q) ||
        t.source.includes(q) ||
        (t.branch ?? "").toLowerCase().includes(q)
      )
    })
  }, [threadList, filter])

  useEffect(() => {
    if (!threadId && filtered.length > 0) {
      const next = new URLSearchParams(params)
      next.set("thread", filtered[0]!.id)
      setParams(next, { replace: true })
    }
  }, [filtered, threadId, params, setParams])

  const selectedThread = filtered.find((t) => t.id === threadId)
  const selectedChannel = channels.data?.find((c) => c.id === channelId)

  if (channels.isLoading) {
    return <div className="text-sm text-zinc-500">Loading channels…</div>
  }
  if (channels.error) {
    return (
      <div className="text-sm text-red-400 px-3 py-2 rounded border border-red-800/40 bg-red-950/20">
        {(channels.error as Error).message}
      </div>
    )
  }
  if (!channels.data || channels.data.length === 0) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Threads</h1>
        <div className="text-sm text-zinc-500 px-4 py-8 rounded-lg border border-zinc-800 bg-zinc-900/20 text-center">
          No chat channels match this workbench yet. Start a Claude Code or
          Cursor session in this worktree to populate.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Threads</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Chat sessions for this workbench. Live from Factory.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {channels.data.length > 1 && (
            <Select.Root
              value={channelId ?? ""}
              onValueChange={(v) => {
                if (typeof v === "string") {
                  setChannelId(v)
                }
              }}
            >
              <Select.Trigger className="group flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100 min-w-[260px]">
                <span className="icon-[ph--chats-circle-duotone] text-[14px] text-zinc-500" />
                <span className="flex-1 text-left truncate flex items-center gap-2">
                  {selectedChannel ? (
                    <>
                      <span className="font-mono text-[10px] text-zinc-500 shrink-0">
                        {selectedChannel.kind}
                      </span>
                      <span className="truncate">
                        {channelLabel(selectedChannel)}
                      </span>
                    </>
                  ) : (
                    <span className="text-zinc-500">select channel…</span>
                  )}
                </span>
                <Select.Icon>
                  <span className="icon-[ph--caret-up-down-bold] text-[12px] text-zinc-500 group-hover:text-zinc-300" />
                </Select.Icon>
              </Select.Trigger>
              <Select.Portal>
                <Select.Positioner sideOffset={6} align="end">
                  <Select.Popup className="origin-[var(--transform-origin)] transition-[transform,opacity] duration-150 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 min-w-[260px] rounded-md border border-zinc-800 bg-zinc-950/95 backdrop-blur-md shadow-xl p-1">
                    {channels.data.map((c) => (
                      <Select.Item
                        key={c.id}
                        value={c.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded text-xs text-zinc-300 cursor-default data-[highlighted]:bg-zinc-800/60 data-[highlighted]:text-zinc-100 data-[selected]:text-sky-300"
                      >
                        <Select.ItemIndicator className="shrink-0">
                          <span className="icon-[ph--check-bold] text-[11px]" />
                        </Select.ItemIndicator>
                        <span className="font-mono text-[10px] text-zinc-500 shrink-0">
                          {c.kind}
                        </span>
                        <Select.ItemText className="truncate">
                          {channelLabel(c)}
                        </Select.ItemText>
                      </Select.Item>
                    ))}
                  </Select.Popup>
                </Select.Positioner>
              </Select.Portal>
            </Select.Root>
          )}
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter…"
            className="text-xs px-2 py-1 rounded border border-zinc-800 bg-zinc-900 text-zinc-200 placeholder:text-zinc-600 focus:border-sky-700 focus:outline-none w-40"
          />
          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            disabled={!threadId}
            title={
              !threadId
                ? "Select a thread to view context"
                : panelOpen
                  ? "Hide context panel"
                  : "Show context panel"
            }
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border ${
              !threadId
                ? "border-zinc-800/50 bg-zinc-900/30 text-zinc-600 cursor-not-allowed"
                : panelOpen
                  ? "border-sky-600/40 bg-sky-950/30 text-sky-200"
                  : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-100 hover:border-zinc-700"
            }`}
          >
            <span className="icon-[ph--sidebar-simple-duotone] text-[13px]" />
            context
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[300px_1fr] gap-4 h-[calc(100vh-140px)]">
        <aside className="rounded-xl border border-zinc-800/60 bg-zinc-950/40 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-zinc-800/60 text-[10px] uppercase tracking-wider text-zinc-500 shrink-0 flex items-center gap-2">
            <span className="icon-[ph--list-duotone] text-[13px] text-zinc-500" />
            {filtered.length} threads
          </div>
          <div className="overflow-y-auto flex-1">
            {threads.isLoading ? (
              <div className="p-3 text-xs text-zinc-500">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="p-3 text-xs text-zinc-500">No threads.</div>
            ) : (
              filtered.map((t) => (
                <ThreadListItem
                  key={t.id}
                  thread={t}
                  selected={t.id === threadId}
                  onClick={() => setThreadId(t.id)}
                />
              ))
            )}
          </div>
        </aside>

        <section className="flex flex-col gap-3 min-w-0 h-full overflow-hidden">
          {selectedThread && (
            <header className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-base font-semibold text-zinc-100">
                    {(
                      selectedThread.title ||
                      selectedThread.spec.generatedTopic ||
                      selectedThread.spec.title ||
                      selectedThread.spec.firstPrompt ||
                      `${selectedThread.source} session`
                    )
                      .split("\n")[0]!
                      .slice(0, 200)}
                  </div>
                  {selectedThread.spec.generatedDescription && (
                    <p className="text-sm text-zinc-400 mt-1">
                      {selectedThread.spec.generatedDescription}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs text-zinc-500 flex-wrap">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`${SOURCE_ICON[selectedThread.source] ?? "icon-[ph--chat-circle-duotone]"} text-[14px] text-zinc-400`}
                      />
                      {selectedThread.source}
                    </span>
                    <StatusPill status={selectedThread.status} />
                    {selectedThread.branch && (
                      <span className="font-mono">
                        ↳ {selectedThread.branch}
                      </span>
                    )}
                    {selectedThread.spec.model && (
                      <span className="font-mono text-zinc-600">
                        {selectedThread.spec.model}
                      </span>
                    )}
                    <span>
                      {formatDuration(
                        selectedThread.startedAt,
                        selectedThread.endedAt
                      )}
                    </span>
                    {selectedThread.spec.turnCount != null && (
                      <span>{selectedThread.spec.turnCount} turns</span>
                    )}
                    {selectedThread.spec.toolCallCount != null && (
                      <span>
                        {selectedThread.spec.toolCallCount} tool calls
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </header>
          )}
          {threadId ? (
            <ThreadView
              threadId={threadId}
              panelOpen={panelOpen}
              onClosePanel={() => setPanelOpen(false)}
              projectRoot={projectRoot}
            />
          ) : (
            <div className="text-sm text-zinc-500 p-6 rounded-lg border border-zinc-800 bg-zinc-900/20 text-center">
              Select a thread to view turns.
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
