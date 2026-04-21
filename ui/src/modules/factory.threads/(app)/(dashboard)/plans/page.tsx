import { useMemo, useState } from "react"

import { cn } from "@rio.js/ui/lib/utils"
import { Icon } from "@rio.js/ui/icon"

import { usePlans } from "../../../data/use-threads"
import type { ThreadPlan, PlanEntry } from "../../../data/types"
import { PlanDrawer } from "../../../components/plan-drawer"

function sourceIcon(source: string | null) {
  switch (source) {
    case "claude-code":
      return "icon-[simple-icons--anthropic]"
    case "cursor":
      return "icon-[simple-icons--cursor]"
    case "superpowers":
      return "icon-[ph--lightning-duotone]"
    default:
      return "icon-[ph--scroll-duotone]"
  }
}

function formatRelative(iso: string | null): string {
  if (!iso) return ""
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diff = now - then
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`
  return `${Math.round(diff / 86_400_000)}d ago`
}

function PlanRow({
  plan,
  onOpen,
}: {
  plan: ThreadPlan
  onOpen: (plan: ThreadPlan) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(plan)}
      className={cn(
        "group w-full text-left flex items-start gap-3 px-4 py-3 rounded-lg border",
        "border-border bg-card hover:border-amber-500/40 hover:bg-amber-500/5 transition-colors"
      )}
    >
      <Icon
        icon={sourceIcon(plan.source)}
        className="text-lg text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="text-base text-foreground truncate font-medium">
            {plan.title ?? (
              <span className="text-muted-foreground italic">untitled</span>
            )}
          </div>
          {plan.stub && (
            <span className="text-xs uppercase tracking-wide px-1.5 py-0.5 rounded border border-muted-foreground/30 text-muted-foreground">
              stub
            </span>
          )}
        </div>
        <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-1 text-xs text-muted-foreground">
          {plan.latestVersion != null && <span>v{plan.latestVersion}</span>}
          {plan.source && (
            <>
              <span>&middot;</span>
              <span>{plan.source}</span>
            </>
          )}
          {plan.editCount > 0 && (
            <>
              <span>&middot;</span>
              <span>{plan.editCount} edits</span>
            </>
          )}
          {plan.updatedAt && (
            <>
              <span>&middot;</span>
              <span title={new Date(plan.updatedAt).toLocaleString()}>
                {formatRelative(plan.updatedAt)}
              </span>
            </>
          )}
        </div>
        <div className="mt-1 text-xs font-mono text-muted-foreground/70 truncate">
          {plan.slug}
        </div>
      </div>
      <Icon
        icon="icon-[ph--arrow-right-bold]"
        className="text-sm text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 mt-1.5"
      />
    </button>
  )
}

export default function PlansPage() {
  const [openPlan, setOpenPlan] = useState<ThreadPlan | null>(null)
  const [search, setSearch] = useState("")
  const [sourceFilter, setSourceFilter] = useState<string | null>(null)
  const { data, isLoading, error } = usePlans({ limit: 500 })

  const plans = data ?? []

  const sources = useMemo(() => {
    const set = new Set<string>()
    for (const p of plans) if (p.source) set.add(p.source)
    return Array.from(set).sort()
  }, [plans])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return plans.filter((p) => {
      if (sourceFilter && p.source !== sourceFilter) return false
      if (!q) return true
      return (
        p.title?.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q)
      )
    })
  }, [plans, search, sourceFilter])

  const drawerEntry: PlanEntry | null = openPlan
    ? {
        id: openPlan.slug,
        slug: openPlan.slug,
        title: openPlan.title ?? openPlan.slug,
        version: openPlan.latestVersion ?? undefined,
        editCount: openPlan.editCount,
        timestamp: openPlan.updatedAt ?? undefined,
      }
    : null

  return (
    <div className="h-full flex">
      <div
        className={cn(
          "flex flex-col min-w-0 transition-all",
          openPlan ? "flex-1 md:max-w-md lg:max-w-lg" : "flex-1"
        )}
      >
        <header className="border-b px-6 py-4 shrink-0">
          <div className="flex items-center gap-3 mb-3">
            <Icon
              icon="icon-[ph--scroll-duotone]"
              className="text-2xl text-amber-600 dark:text-amber-400"
            />
            <h1 className="text-2xl font-semibold">Plans</h1>
            <span className="text-base text-muted-foreground">
              {plans.length} total
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-64 max-w-md">
              <Icon
                icon="icon-[ph--magnifying-glass]"
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search plans..."
                className="w-full h-9 pl-8 pr-3 rounded-md border bg-background text-base focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
            </div>
            <button
              type="button"
              onClick={() => setSourceFilter(null)}
              className={cn(
                "h-9 px-3 rounded-md border text-sm",
                sourceFilter === null
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : "border-border hover:bg-accent text-muted-foreground"
              )}
            >
              All
            </button>
            {sources.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSourceFilter(s)}
                className={cn(
                  "h-9 px-3 rounded-md border text-sm",
                  sourceFilter === s
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : "border-border hover:bg-accent text-muted-foreground"
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Icon
                icon="icon-[ph--circle-notch-duotone]"
                className="animate-spin"
              />
              Loading plans...
            </div>
          )}
          {error && (
            <div className="text-red-500 text-sm">
              Failed to load: {(error as Error).message}
            </div>
          )}
          {!isLoading && !error && filtered.length === 0 && (
            <div className="text-muted-foreground text-base">
              {plans.length === 0
                ? "No plans yet."
                : "No plans match your search."}
            </div>
          )}
          <div className="space-y-2 max-w-3xl">
            {filtered.map((p) => (
              <PlanRow key={p.slug} plan={p} onOpen={setOpenPlan} />
            ))}
          </div>
        </div>
      </div>
      {openPlan && (
        <div className="flex-1 min-w-0 hidden md:block">
          <PlanDrawer
            plan={drawerEntry}
            onClose={() => setOpenPlan(null)}
            mode="inline"
          />
        </div>
      )}
      {openPlan && (
        <div className="md:hidden">
          <PlanDrawer
            plan={drawerEntry}
            onClose={() => setOpenPlan(null)}
            mode="drawer"
          />
        </div>
      )}
    </div>
  )
}
