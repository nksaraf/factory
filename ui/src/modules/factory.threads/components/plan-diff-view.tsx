import { useMemo } from "react"
import { FileDiff } from "@pierre/diffs/react"
import { parseDiffFromFile } from "@pierre/diffs"

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

  const fileDiff = useMemo(() => {
    if (!fromText && !toText) return null
    try {
      return parseDiffFromFile(
        {
          name: `${slug}.md`,
          contents: fromText,
          cacheKey: `${slug}@v${fromVersion}`,
        },
        {
          name: `${slug}.md`,
          contents: toText,
          cacheKey: `${slug}@v${toVersion}`,
        }
      )
    } catch {
      return null
    }
  }, [slug, fromText, toText, fromVersion, toVersion])

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
        {!isLoading && !error && fileDiff && (
          <FileDiff fileDiff={fileDiff} disableWorkerPool />
        )}
        {!isLoading && !error && !fileDiff && (
          <div className="px-5 py-4 text-muted-foreground text-sm">
            No differences.
          </div>
        )}
      </div>
    </div>
  )
}
