import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router"

import { cn } from "@rio.js/ui/lib/utils"
import { Icon } from "@rio.js/ui/icon"

import {
  useChannelThreads,
  useThread,
  useThreadChannels,
  useThreadExchanges,
  useThreadMessages,
  useThreadPlans,
  useThreadTurns,
} from "../../../data/use-threads"
import type {
  PlanEntry,
  Thread,
  ThreadPlan,
  ThreadTurn,
} from "../../../data/types"
import {
  SOURCE_ICON,
  ROLE_STYLE,
  ROLE_ICON,
  toolIcon,
  formatDuration,
  relativeTime,
  formatTokens,
  detectPlanSlug,
  summarizeToolInput,
  channelLabel,
} from "../../../components/thread-helpers"
import { PlanDrawer } from "../../../components/plan-drawer"
import { ThreadContextPanel } from "../../../components/thread-context-panel"
import { ExchangeView } from "../../../components/exchange-view"
import { Markdown } from "../../../components/markdown"

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "text-xs uppercase tracking-wide px-1.5 py-0.5 rounded border font-medium",
        status === "active" &&
          "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-600/30",
        status === "completed" &&
          "bg-muted text-muted-foreground border-border",
        status === "failed" &&
          "bg-red-500/10 text-red-600 dark:text-red-400 border-red-600/30",
        !["active", "completed", "failed"].includes(status) &&
          "bg-muted text-muted-foreground border-border"
      )}
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
        : "bg-muted-foreground/40"
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "w-full text-left px-3 py-2 border-l-2 flex items-center gap-2 transition-colors",
        selected
          ? "border-primary bg-accent"
          : "border-transparent hover:bg-accent/50"
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotColor)} />
      <span
        className={cn(
          SOURCE_ICON[thread.source] ?? "icon-[ph--chat-circle-duotone]",
          "text-sm text-muted-foreground shrink-0"
        )}
      />
      <span
        className={cn(
          "text-sm truncate flex-1",
          selected ? "text-foreground font-medium" : "text-foreground/80"
        )}
      >
        {title}
      </span>
      <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
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
  cwd,
}: {
  name: string
  input?: string
  failed?: boolean
  onOpenPlan?: (slug: string) => void
  cwd?: string
}) {
  const [open, setOpen] = useState(false)
  const summary = summarizeToolInput(name, input, cwd)
  const planSlug = detectPlanSlug(name, input)
  return (
    <div
      className={cn(
        "text-xs font-mono border-l-2",
        failed
          ? "border-red-600/60"
          : planSlug
            ? "border-amber-600/50"
            : "border-transparent"
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-1 text-left hover:bg-accent text-muted-foreground hover:text-foreground"
      >
        <span className="text-muted-foreground/60">
          {open ? "\u25BE" : "\u25B8"}
        </span>
        <span
          className={cn(
            planSlug ? "icon-[ph--scroll-duotone]" : toolIcon(name),
            "text-sm",
            failed
              ? "text-red-500"
              : planSlug
                ? "text-amber-500"
                : "text-violet-500"
          )}
        />
        <span
          className={cn(
            "font-semibold",
            failed
              ? "text-red-600 dark:text-red-400"
              : planSlug
                ? "text-amber-600 dark:text-amber-400"
                : "text-violet-600 dark:text-violet-400"
          )}
        >
          {planSlug ? `${name} plan` : name}
        </span>
        <span className="truncate flex-1 text-muted-foreground">{summary}</span>
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
            className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-600/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 text-xs cursor-pointer"
            title="Open plan"
          >
            <span className="icon-[ph--arrow-square-out] text-xs" />
            open
          </span>
        )}
      </button>
      {open && input && (
        <pre className="px-4 py-1.5 text-xs bg-muted rounded m-1 whitespace-pre-wrap break-all text-muted-foreground">
          {input}
        </pre>
      )}
    </div>
  )
}

function ToolTurnRow({
  turn,
  onOpenPlan,
  cwd,
}: {
  turn: ThreadTurn
  onOpenPlan?: (slug: string) => void
  cwd?: string
}) {
  const [open, setOpen] = useState(false)
  const name = turn.spec.toolName ?? "tool"
  const summary = summarizeToolInput(
    turn.spec.toolName,
    turn.spec.toolInput,
    cwd
  )
  const failed = !!turn.spec.failed
  const planSlug = detectPlanSlug(turn.spec.toolName, turn.spec.toolInput)
  return (
    <div
      id={`turn-${turn.id}`}
      className={cn(
        "text-xs font-mono border-l-2 transition-shadow",
        failed
          ? "border-red-600/60"
          : planSlug
            ? "border-amber-600/50"
            : "border-transparent"
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-1 text-left hover:bg-accent text-muted-foreground hover:text-foreground"
      >
        <span className="text-muted-foreground/60">
          {open ? "\u25BE" : "\u25B8"}
        </span>
        <span
          className={cn(
            planSlug
              ? "icon-[ph--scroll-duotone]"
              : toolIcon(turn.spec.toolName),
            "text-sm",
            failed
              ? "text-red-500"
              : planSlug
                ? "text-amber-500"
                : "text-violet-500"
          )}
        />
        <span
          className={cn(
            "font-semibold",
            failed
              ? "text-red-600 dark:text-red-400"
              : planSlug
                ? "text-amber-600 dark:text-amber-400"
                : "text-violet-600 dark:text-violet-400"
          )}
        >
          {planSlug ? `${name} plan` : name}
        </span>
        <span className="truncate flex-1 text-muted-foreground">{summary}</span>
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
            className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-600/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 text-xs cursor-pointer"
            title="Open plan"
          >
            <span className="icon-[ph--arrow-square-out] text-xs" />
            open
          </span>
        )}
        {turn.spec.timestamp && (
          <span className="text-muted-foreground text-xs shrink-0">
            {new Date(turn.spec.timestamp).toLocaleTimeString()}
          </span>
        )}
      </button>
      {open && (
        <div className="px-4 py-1.5 space-y-1.5 text-xs">
          {turn.spec.toolInput && (
            <pre className="bg-muted rounded p-2 whitespace-pre-wrap break-all text-muted-foreground">
              {turn.spec.toolInput}
            </pre>
          )}
          {turn.spec.toolOutput && (
            <pre className="bg-muted rounded p-2 whitespace-pre-wrap break-all text-muted-foreground max-h-48 overflow-auto">
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
    <div className="mt-3 rounded-lg border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-accent/50"
      >
        <span className="text-muted-foreground/60">
          {open ? "\u25BE" : "\u25B8"}
        </span>
        <span>{calls.length} tool calls</span>
        {planCount > 0 && (
          <span className="text-amber-600 dark:text-amber-400 normal-case inline-flex items-center gap-1">
            &middot; <span className="icon-[ph--scroll-duotone] text-xs" />{" "}
            {planCount} plan{planCount > 1 ? "s" : ""}
          </span>
        )}
        {failedCount > 0 && (
          <span className="text-red-600 dark:text-red-400 normal-case">
            &middot; {failedCount} failed
          </span>
        )}
      </button>
      {open && (
        <div className="border-t divide-y py-0.5">
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
    <div className="rounded-lg border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-accent/50"
      >
        <span className="text-muted-foreground/60">
          {open ? "\u25BE" : "\u25B8"}
        </span>
        <span>{turns.length} tool calls</span>
        {planCount > 0 && (
          <span className="text-amber-600 dark:text-amber-400 normal-case inline-flex items-center gap-1">
            &middot; <span className="icon-[ph--scroll-duotone] text-xs" />{" "}
            {planCount} plan{planCount > 1 ? "s" : ""}
          </span>
        )}
        {failedCount > 0 && (
          <span className="text-red-600 dark:text-red-400 normal-case">
            &middot; {failedCount} failed
          </span>
        )}
        <span className="ml-auto text-muted-foreground/60 normal-case font-mono">
          #{turns[0]!.turnIndex}&ndash;{turns[turns.length - 1]!.turnIndex}
        </span>
      </button>
      {open && (
        <div className="border-t divide-y py-0.5">
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
  const cls = ROLE_STYLE[turn.role] ?? "border-border bg-card"
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
      className={cn(
        "rounded-lg border p-4 transition-shadow",
        cls,
        isPlan && "ring-1 ring-amber-500/30"
      )}
    >
      <header className="flex items-center gap-2 mb-2 text-sm">
        <span
          className={cn(
            ROLE_ICON[turn.role] ?? "icon-[ph--chat-circle-duotone]",
            "text-base",
            turn.role === "user"
              ? "text-sky-500"
              : turn.role === "assistant"
                ? "text-orange-500"
                : turn.role === "subagent"
                  ? "text-emerald-500"
                  : "text-muted-foreground"
          )}
        />
        <span className="font-semibold uppercase tracking-wide text-foreground/80">
          {turn.role}
        </span>
        {isPlan && planSlug && (
          <button
            type="button"
            onClick={() => onOpenPlan?.(planSlug)}
            className="group inline-flex items-center gap-1 text-xs uppercase tracking-wide px-2 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-colors"
            title="Open plan in side panel"
          >
            <span className="icon-[ph--scroll-duotone] text-xs" />
            Plan
            <span className="icon-[ph--arrow-square-out] text-xs opacity-60 group-hover:opacity-100" />
          </button>
        )}
        {turn.spec.toolName && (
          <span className="font-mono text-violet-600 dark:text-violet-400">
            {turn.spec.toolName}
          </span>
        )}
        {turn.spec.failed && (
          <span className="text-red-500 text-xs font-medium">FAILED</span>
        )}
        <span className="text-xs text-muted-foreground ml-auto font-mono">
          #{turn.turnIndex}
          {turn.spec.timestamp &&
            ` \u00B7 ${new Date(turn.spec.timestamp).toLocaleTimeString()}`}
        </span>
      </header>

      {turn.role === "user" && text && <Markdown text={text} />}

      {turn.role === "assistant" && text && <Markdown text={text} />}

      {text &&
        turn.role !== "user" &&
        turn.role !== "assistant" &&
        turn.role !== "tool" && <Markdown text={text} />}

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
        <footer className="mt-2 text-xs text-muted-foreground font-mono">
          in {formatTokens(turn.spec.tokenUsage?.input)} &middot; out{" "}
          {formatTokens(turn.spec.tokenUsage?.output)}
          {turn.spec.tokenUsage?.cacheRead
            ? ` \u00B7 cache ${formatTokens(turn.spec.tokenUsage.cacheRead)}`
            : ""}
          {turn.spec.model && ` \u00B7 ${turn.spec.model}`}
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
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2 mb-2 text-xs uppercase tracking-wider font-semibold text-amber-700 dark:text-amber-400">
        <Icon icon="icon-[ph--scroll-duotone]" className="text-sm" />
        Plans in this thread ({plans.length})
      </div>
      <div className="space-y-1">
        {plans.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onOpen(p.slug)}
            className="group w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md border border-transparent hover:border-amber-500/30 hover:bg-amber-500/10 text-left transition-colors"
          >
            <Icon
              icon="icon-[ph--file-text-duotone]"
              className="text-sm text-amber-500/70 group-hover:text-amber-500"
            />
            <span className="text-sm text-foreground group-hover:text-foreground truncate flex-1">
              {p.title}
            </span>
            {p.version != null && (
              <span className="text-xs font-mono text-muted-foreground shrink-0">
                v{p.version}
              </span>
            )}
            {p.turnIndex != null && (
              <span className="text-xs font-mono text-muted-foreground shrink-0">
                #{p.turnIndex}
              </span>
            )}
            <Icon
              icon="icon-[ph--arrow-square-out]"
              className="text-xs text-muted-foreground group-hover:text-amber-500"
            />
          </button>
        ))}
      </div>
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

function ThreadView({
  threadId,
  threadStatus,
  threadCwd,
  panelOpen,
  onClosePanel,
}: {
  threadId: string
  threadStatus?: string
  threadCwd?: string
  panelOpen: boolean
  onClosePanel: () => void
}) {
  const messages = useThreadMessages(threadId, threadStatus)
  const exchanges = useThreadExchanges(threadId, threadStatus)
  const hasMessages = (messages.data?.length ?? 0) > 0

  const turns = useThreadTurns(threadId)
  const threadPlans = useThreadPlans(threadId)
  const list = turns.data ?? []
  const [openPlanSlug, setOpenPlanSlug] = useState<string | null>(null)

  const jumpToTurn = (turnId: string) => {
    const el = document.getElementById(`turn-${turnId}`)
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" })
      el.classList.add("ring-2", "ring-primary/60")
      setTimeout(() => el.classList.remove("ring-2", "ring-primary/60"), 1800)
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
      if (raw.sourceTurnId) m.set(raw.sourceTurnId, planToEntry(raw, turnsById))
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

  if (hasMessages) {
    return (
      <div className="flex gap-3 min-w-0 flex-1 min-h-0">
        <ExchangeView
          messages={messages.data!}
          exchanges={exchanges.data ?? []}
          threadStatus={threadStatus}
          cwd={threadCwd}
        />
        {panelOpen && (
          <div className="w-80 shrink-0 h-full">
            <ThreadContextPanel
              turns={list}
              plans={plans}
              onOpenPlan={setOpenPlanSlug}
              onJumpToTurn={jumpToTurn}
              onClose={onClosePanel}
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

  if (turns.isLoading)
    return (
      <div className="text-sm text-muted-foreground p-6">Loading turns...</div>
    )
  if (list.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-6 rounded-lg border bg-card text-center">
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

export default function ThreadsPage() {
  const channels = useThreadChannels()
  const [params, setParams] = useSearchParams()
  const channelId = params.get("channel")
  const threadId = params.get("thread")
  const [filter, setFilter] = useState("")
  const [panelOpen, setPanelOpen] = useState(true)

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

  // When a thread is in the URL but the channel isn't, look up the thread's
  // channel and backfill it so the list + context render correctly.
  const threadLookup = useThread(!channelId && threadId ? threadId : null)

  useEffect(() => {
    if (channelId) return
    const threadChannel = threadLookup.data?.channelId
    if (threadId && threadChannel) {
      const next = new URLSearchParams(params)
      next.set("channel", threadChannel)
      setParams(next, { replace: true })
      return
    }
    if (!threadId && channels.data && channels.data.length > 0) {
      const next = new URLSearchParams(params)
      next.set("channel", channels.data[0]!.id)
      setParams(next, { replace: true })
    }
  }, [
    channels.data,
    channelId,
    threadId,
    threadLookup.data?.channelId,
    params,
    setParams,
  ])

  const threads = useChannelThreads(channelId)
  const threadList = useMemo(() => {
    const list = threads.data ?? []
    return [...list].sort((a, b) => {
      const aTime = new Date(a.endedAt ?? a.startedAt).getTime()
      const bTime = new Date(b.endedAt ?? b.startedAt).getTime()
      return bTime - aTime
    })
  }, [threads.data])
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

  if (channels.isLoading)
    return (
      <div className="text-sm text-muted-foreground p-6">
        Loading channels...
      </div>
    )
  if (channels.error) {
    return (
      <div className="text-sm text-red-500 px-3 py-2 rounded border border-red-500/30 bg-red-500/5">
        {(channels.error as Error).message}
      </div>
    )
  }
  if (!channels.data || channels.data.length === 0) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Threads</h1>
        <div className="text-sm text-muted-foreground px-4 py-8 rounded-lg border bg-card text-center">
          No channels found. Start a Claude Code or Cursor session to populate.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full p-6 gap-4">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-semibold">Threads</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Agent sessions and conversations
          </p>
        </div>
        <div className="flex items-center gap-2">
          {channels.data.length > 1 && (
            <select
              value={channelId ?? ""}
              onChange={(e) => setChannelId(e.target.value || null)}
              className="text-sm px-2.5 py-1.5 rounded-md border bg-card text-foreground"
            >
              {channels.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.kind} &middot; {channelLabel(c)}
                </option>
              ))}
            </select>
          )}
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter threads..."
            className="w-40 text-sm px-2.5 py-1.5 rounded-md border bg-card text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            disabled={!threadId}
            title={
              !threadId
                ? "Select a thread"
                : panelOpen
                  ? "Hide context panel"
                  : "Show context panel"
            }
            className={cn(
              "flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-md border",
              !threadId
                ? "border-border/50 bg-muted/30 text-muted-foreground cursor-not-allowed"
                : panelOpen
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-border"
            )}
          >
            <Icon
              icon="icon-[ph--sidebar-simple-duotone]"
              className="text-sm"
            />
            context
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4 min-h-0 flex-1">
        <aside className="rounded-xl border bg-card flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b text-xs uppercase tracking-wider text-muted-foreground shrink-0 flex items-center gap-2">
            <Icon icon="icon-[ph--list-duotone]" className="text-sm" />
            {filtered.length} threads
          </div>
          <div className="overflow-y-auto flex-1">
            {threads.isLoading ? (
              <div className="p-3 text-sm text-muted-foreground">
                Loading...
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">
                No threads.
              </div>
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
            <header className="rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-base font-semibold text-foreground">
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
                    <p className="text-sm text-muted-foreground mt-1">
                      {selectedThread.spec.generatedDescription}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          SOURCE_ICON[selectedThread.source] ??
                            "icon-[ph--chat-circle-duotone]",
                          "text-sm"
                        )}
                      />
                      {selectedThread.source}
                    </span>
                    <StatusPill status={selectedThread.status} />
                    {selectedThread.branch && (
                      <span className="font-mono">
                        &cularr; {selectedThread.branch}
                      </span>
                    )}
                    {selectedThread.spec.model && (
                      <span className="font-mono text-muted-foreground/60">
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
              threadStatus={selectedThread?.status}
              threadCwd={
                (selectedThread?.spec?.cwd as string | undefined) ??
                ((channels.data ?? []).find((c) => c.id === channelId)?.spec
                  ?.cwd as string | undefined)
              }
              panelOpen={panelOpen}
              onClosePanel={() => setPanelOpen(false)}
            />
          ) : (
            <div className="text-sm text-muted-foreground p-6 rounded-lg border bg-card text-center">
              Select a thread to view turns.
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
