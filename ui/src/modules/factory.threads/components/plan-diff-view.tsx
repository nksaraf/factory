import { useMemo } from "react"
import { diffLines, type Change } from "diff"

import { cn } from "@rio.js/ui/lib/utils"
import { Icon } from "@rio.js/ui/icon"

import { usePlanContent } from "../data/use-threads"

export function PlanDiffView({
  slug,
  fromVersion,
  toVersion,
  fromLabel,
  toLabel,
  onClose,
}: {
  slug: string
  fromVersion: number
  toVersion: number
  fromLabel?: string
  toLabel?: string
  onClose: () => void
}) {
  const fromQ = usePlanContent(slug, fromVersion)
  const toQ = usePlanContent(slug, toVersion)
  const fromText = fromQ.data?.content ?? ""
  const toText = toQ.data?.content ?? ""
  const isLoading = fromQ.isLoading || toQ.isLoading
  const error =
    (fromQ.error instanceof Error ? fromQ.error.message : null) ??
    (toQ.error instanceof Error ? toQ.error.message : null)

  const changes = useMemo<Change[]>(() => {
    if (!fromText && !toText) return []
    return diffLines(fromText, toText)
  }, [fromText, toText])

  const stats = useMemo(() => {
    let added = 0
    let removed = 0
    for (const c of changes) {
      const lines = (c.value.match(/\n/g) || []).length || (c.value ? 1 : 0)
      if (c.added) added += lines
      else if (c.removed) removed += lines
    }
    return { added, removed }
  }, [changes])

  return (
    <div className="h-full flex flex-col bg-background">
      <header className="flex items-center justify-between px-5 py-3 border-b shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Icon
            icon="icon-[ph--git-diff-duotone]"
            className="text-base text-amber-500 shrink-0"
          />
          <div className="text-base font-semibold truncate">
            {fromLabel ?? `v${fromVersion}`}
            <span className="text-muted-foreground mx-1.5">→</span>
            {toLabel ?? `v${toVersion}`}
          </div>
          {(stats.added > 0 || stats.removed > 0) && (
            <div className="flex items-center gap-2 text-xs font-mono shrink-0">
              <span className="text-emerald-600 dark:text-emerald-400">
                +{stats.added}
              </span>
              <span className="text-red-600 dark:text-red-400">
                -{stats.removed}
              </span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close diff"
          className="h-8 w-8 rounded-md border hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center"
        >
          <Icon icon="icon-[ph--x-bold]" className="text-sm" />
        </button>
      </header>
      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="px-5 py-4 flex items-center gap-2 text-muted-foreground text-sm">
            <Icon
              icon="icon-[ph--circle-notch-duotone]"
              className="animate-spin"
            />
            Loading diff...
          </div>
        )}
        {error && <div className="px-5 py-4 text-red-500 text-sm">{error}</div>}
        {!isLoading && !error && changes.length === 0 && (
          <div className="px-5 py-4 text-muted-foreground text-sm">
            No differences.
          </div>
        )}
        {!isLoading && !error && changes.length > 0 && (
          <pre className="font-mono text-xs leading-relaxed">
            {changes.map((c, idx) => (
              <DiffBlock key={idx} change={c} />
            ))}
          </pre>
        )}
      </div>
    </div>
  )
}

function DiffBlock({ change }: { change: Change }) {
  const lines = change.value.replace(/\n$/, "").split("\n")
  const cls = change.added
    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    : change.removed
      ? "bg-red-500/10 text-red-700 dark:text-red-300"
      : "text-muted-foreground"
  const prefix = change.added ? "+" : change.removed ? "-" : " "
  return (
    <>
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            "px-5 py-px whitespace-pre-wrap break-all border-l-2",
            change.added
              ? "border-emerald-500/50"
              : change.removed
                ? "border-red-500/50"
                : "border-transparent",
            cls
          )}
        >
          <span className="select-none mr-2 opacity-50">{prefix}</span>
          {line || " "}
        </div>
      ))}
    </>
  )
}
