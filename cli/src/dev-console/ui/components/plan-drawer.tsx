import { useEffect, useState } from "react"

import { usePlanContent, usePlanVersions } from "../hooks/use-queries.js"
import { cn } from "../lib/cn.js"
import { Markdown } from "./markdown.js"

export interface PlanEntry {
  id: string
  slug: string
  title: string
  turnIndex?: number
  timestamp?: string
  version?: number | null
  editCount?: number
  text?: string
}

export function PlanDrawer({
  plan,
  onClose,
  onJumpToTurn,
}: {
  plan: PlanEntry | null
  onClose: () => void
  onJumpToTurn?: (turnId: string) => void
}) {
  const [showVersions, setShowVersions] = useState(false)
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

  return (
    <>
      <div
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-black/40 backdrop-blur-sm transition-opacity",
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      />
      <aside
        className={cn(
          "fixed top-0 right-0 z-40 h-screen w-full max-w-2xl",
          "border-l border-zinc-800/60 bg-zinc-950/95 backdrop-blur-md",
          "shadow-2xl shadow-black/60",
          "transition-transform duration-200 ease-out",
          "flex flex-col",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-zinc-800/60 shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-amber-300/80 font-semibold mb-1">
              <span className="icon-[ph--scroll-duotone] text-[14px]" />
              Plan
              {latestVersion != null && (
                <span className="text-zinc-500 normal-case font-mono">
                  v{latestVersion}
                </span>
              )}
              {plan?.editCount ? (
                <span className="text-zinc-600 normal-case">
                  · {plan.editCount} edits
                </span>
              ) : null}
              {plan?.timestamp && (
                <span className="text-zinc-600 normal-case">
                  · {new Date(plan.timestamp).toLocaleString()}
                </span>
              )}
            </div>
            <h2 className="text-base font-semibold text-zinc-100 truncate">
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
                  "h-8 px-2 rounded-md border text-[11px] flex items-center gap-1.5",
                  showVersions
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                    : "border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-100"
                )}
              >
                <span className="icon-[ph--clock-counter-clockwise-duotone] text-[13px]" />
                <span className="font-mono">{versions.length}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              title="Close (Esc)"
              className="h-8 w-8 rounded-md border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-100 flex items-center justify-center"
            >
              <span className="icon-[ph--x-bold] text-[14px]" />
            </button>
          </div>
        </header>
        {showVersions && versions.length > 0 && (
          <div className="border-b border-zinc-800/60 bg-zinc-950/60 px-5 py-3 max-h-[40vh] overflow-y-auto shrink-0">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
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
                          "flex items-start gap-3 rounded-md border px-2.5 py-1.5 text-xs",
                          isLatest
                            ? "border-amber-500/30 bg-amber-500/5"
                            : "border-zinc-800/60 bg-zinc-900/30"
                        )}
                      >
                        <span
                          className={cn(
                            "font-mono shrink-0 mt-0.5",
                            isLatest ? "text-amber-300" : "text-zinc-500"
                          )}
                        >
                          v{v.version}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-zinc-200 truncate">
                            {v.title ?? (
                              <span className="text-zinc-600 italic">
                                untitled
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-zinc-600 font-mono">
                            {v.createdAt && (
                              <span>
                                {new Date(v.createdAt).toLocaleString()}
                              </span>
                            )}
                            {v.source && <span>· {v.source}</span>}
                            {v.sizeBytes != null && (
                              <span>· {v.sizeBytes}b</span>
                            )}
                          </div>
                        </div>
                        {v.sourceTurnId && onJumpToTurn && (
                          <button
                            type="button"
                            onClick={() => onJumpToTurn(v.sourceTurnId!)}
                            title="Jump to source turn"
                            className="shrink-0 h-6 w-6 rounded border border-zinc-800 hover:border-sky-600 hover:bg-sky-950/40 text-zinc-500 hover:text-sky-300 flex items-center justify-center"
                          >
                            <span className="icon-[ph--arrow-right-bold] text-[11px]" />
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
            </ol>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="icon-[ph--circle-notch-duotone] animate-spin text-[14px]" />
              Loading plan…
            </div>
          )}
          {!loading && error && (
            <div className="text-xs text-red-400 font-mono">
              Failed to load: {error}
            </div>
          )}
          {!loading && !error && body && <Markdown text={body} />}
          {!loading && !error && !body && plan && (
            <div className="text-xs text-zinc-500">No content available.</div>
          )}
        </div>
      </aside>
    </>
  )
}
