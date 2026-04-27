import { useEffect, useState } from "react"

import { cn } from "@rio.js/ui/lib/utils"
import { Icon } from "@rio.js/ui/icon"

import { usePlanContent, usePlanVersions } from "../data/use-threads"
import type { PlanEntry } from "../data/types"
import { Markdown } from "./markdown"
import { PlanDiffView } from "./plan-diff-view"

export function PlanDrawer({
  plan,
  onClose,
  onJumpToTurn,
  mode = "drawer",
}: {
  plan: PlanEntry | null
  onClose: () => void
  onJumpToTurn?: (turnId: string) => void
  mode?: "drawer" | "inline"
}) {
  const [showVersions, setShowVersions] = useState(false)
  const [diff, setDiff] = useState<{ from: number; to: number } | null>(null)
  useEffect(() => {
    if (!plan) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [plan, onClose])

  useEffect(() => {
    setShowVersions(false)
    setDiff(null)
  }, [plan?.slug])

  const open = plan !== null
  const contentQuery = usePlanContent(plan?.slug ?? null)
  const versionsQuery = usePlanVersions(plan?.slug ?? null)
  const versions = versionsQuery.data ?? []
  const body = contentQuery.data?.content ?? plan?.text ?? ""
  const loading = contentQuery.isLoading && !plan?.text
  const error =
    contentQuery.error instanceof Error ? contentQuery.error.message : null
  const latestVersion = contentQuery.data?.version ?? plan?.version ?? null

  if (mode === "inline" && !open) return null

  return (
    <>
      {mode === "drawer" && (
        <div
          onClick={onClose}
          className={cn(
            "fixed inset-0 z-30 bg-black/40 backdrop-blur-sm transition-opacity",
            open ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
        />
      )}
      <aside
        className={cn(
          "border-l bg-background flex flex-col",
          mode === "drawer"
            ? cn(
                "fixed top-0 right-0 z-40 h-screen w-full max-w-2xl shadow-2xl",
                "transition-transform duration-200 ease-out",
                open ? "translate-x-0" : "translate-x-full"
              )
            : "h-full w-full"
        )}
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-amber-600 dark:text-amber-400 font-semibold mb-1">
              <Icon icon="icon-[ph--scroll-duotone]" className="text-sm" />
              Plan
              {latestVersion != null && (
                <span className="text-muted-foreground normal-case font-mono">
                  v{latestVersion}
                </span>
              )}
              {plan?.editCount ? (
                <span className="text-muted-foreground normal-case">
                  &middot; {plan.editCount} edits
                </span>
              ) : null}
              {plan?.timestamp && (
                <span className="text-muted-foreground normal-case">
                  &middot; {new Date(plan.timestamp).toLocaleString()}
                </span>
              )}
            </div>
            <h2 className="text-lg font-semibold text-foreground truncate">
              {plan?.title ?? "Plan"}
            </h2>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {versions.length > 1 && (
              <button
                type="button"
                onClick={() => setShowVersions((v) => !v)}
                title="Version history"
                className={cn(
                  "h-8 px-2 rounded-md border text-xs flex items-center gap-1.5",
                  showVersions
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : "border-border hover:bg-accent text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon
                  icon="icon-[ph--clock-counter-clockwise-duotone]"
                  className="text-sm"
                />
                <span className="font-mono">{versions.length}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              title="Close (Esc)"
              className="h-8 w-8 rounded-md border hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center"
            >
              <Icon icon="icon-[ph--x-bold]" className="text-sm" />
            </button>
          </div>
        </header>
        {showVersions && versions.length > 0 && (
          <div className="border-b bg-muted/30 px-5 py-3 max-h-[40vh] overflow-y-auto shrink-0">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-semibold">
              Version history
            </div>
            <ol className="space-y-1">
              {[...versions]
                .sort((a, b) => b.version - a.version)
                .map((v) => {
                  const isLatest = v.version === latestVersion
                  return (
                    <li key={v.id || v.version}>
                      <div
                        className={cn(
                          "flex items-start gap-3 rounded-md border px-2.5 py-1.5 text-sm",
                          isLatest
                            ? "border-amber-500/30 bg-amber-500/5"
                            : "border-border bg-card"
                        )}
                      >
                        <span
                          className={cn(
                            "font-mono shrink-0 mt-0.5 text-xs",
                            isLatest
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground"
                          )}
                        >
                          v{v.version}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-foreground truncate text-sm">
                            {v.title ?? (
                              <span className="text-muted-foreground italic">
                                untitled
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground font-mono">
                            {v.createdAt && (
                              <span>
                                {new Date(v.createdAt).toLocaleString()}
                              </span>
                            )}
                            {v.source && <span>&middot; {v.source}</span>}
                            {v.sizeBytes != null && (
                              <span>&middot; {v.sizeBytes}b</span>
                            )}
                          </div>
                        </div>
                        {v.version > 1 && plan?.slug && (
                          <button
                            type="button"
                            onClick={() =>
                              setDiff({ from: v.version - 1, to: v.version })
                            }
                            title={`Diff v${v.version - 1} → v${v.version}`}
                            className="shrink-0 h-6 w-6 rounded border hover:border-amber-500/60 hover:bg-amber-500/10 text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400 flex items-center justify-center"
                          >
                            <Icon
                              icon="icon-[ph--git-diff-duotone]"
                              className="text-xs"
                            />
                          </button>
                        )}
                        {v.sourceTurnId && onJumpToTurn && (
                          <button
                            type="button"
                            onClick={() => onJumpToTurn(v.sourceTurnId!)}
                            title="Jump to source turn"
                            className="shrink-0 h-6 w-6 rounded border hover:border-primary hover:bg-primary/10 text-muted-foreground hover:text-primary flex items-center justify-center"
                          >
                            <Icon
                              icon="icon-[ph--arrow-right-bold]"
                              className="text-xs"
                            />
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
            </ol>
          </div>
        )}
        {diff && plan?.slug ? (
          <div className="flex-1 min-h-0">
            <PlanDiffView
              slug={plan.slug}
              fromVersion={diff.from}
              toVersion={diff.to}
              onClose={() => setDiff(null)}
            />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon
                  icon="icon-[ph--circle-notch-duotone]"
                  className="animate-spin text-sm"
                />
                Loading plan...
              </div>
            )}
            {!loading && error && (
              <div className="text-sm text-red-500 font-mono">
                Failed to load: {error}
              </div>
            )}
            {!loading && !error && body && <Markdown text={body} />}
            {!loading && !error && !body && plan && (
              <div className="text-sm text-muted-foreground">
                No content available.
              </div>
            )}
          </div>
        )}
      </aside>
    </>
  )
}
