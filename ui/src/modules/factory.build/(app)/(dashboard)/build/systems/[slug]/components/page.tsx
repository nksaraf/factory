import { useMemo, useState } from "react"
import { useParams } from "react-router"

import { cn } from "@rio.js/ui/lib/utils"
import { Icon } from "@rio.js/ui/icon"

import { EmptyState, StatusBadge } from "@/components/factory"
import { useSystemComponents } from "../../../../../../data/use-build"
import { SystemLayout } from "../system-layout"

export default function SystemComponentsTab() {
  const { slug } = useParams<{ slug: string }>()
  const { data: components, isLoading } = useSystemComponents(slug)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)

  const all = components ?? []
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const c of all)
      counts[c.type ?? "unknown"] = (counts[c.type ?? "unknown"] ?? 0) + 1
    return counts
  }, [all])

  const filtered = typeFilter
    ? all.filter((c: any) => (c.type ?? "unknown") === typeFilter)
    : all

  return (
    <SystemLayout>
      <div className="space-y-4">
        <div className="flex gap-1 rounded-lg border bg-muted p-1 flex-wrap">
          <button
            type="button"
            onClick={() => setTypeFilter(null)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              !typeFilter
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            All ({all.length})
          </button>
          {Object.entries(typeCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => (
              <button
                key={type}
                type="button"
                onClick={() => setTypeFilter(typeFilter === type ? null : type)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  typeFilter === type
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {type} ({count})
              </button>
            ))}
        </div>

        {isLoading && (
          <p className="text-sm text-muted-foreground">Loading...</p>
        )}
        {!isLoading && filtered.length === 0 && (
          <EmptyState
            icon="icon-[ph--puzzle-piece-duotone]"
            title="No components"
          />
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c: any) => {
            const deps = Array.isArray(c.spec?.dependsOn)
              ? c.spec.dependsOn
              : []
            const ports = Array.isArray(c.spec?.ports) ? c.spec.ports : []
            return (
              <div
                key={c.id ?? c.slug}
                className="rounded-lg border bg-card p-4 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon
                      icon="icon-[ph--puzzle-piece-duotone]"
                      className="text-base text-muted-foreground"
                    />
                    <span className="font-medium text-base">
                      {c.name ?? c.slug}
                    </span>
                  </div>
                  <StatusBadge
                    status={
                      typeof c.lifecycle === "string" ? c.lifecycle : "unknown"
                    }
                  />
                </div>
                <div className="mt-2 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted font-mono text-muted-foreground">
                      {c.type ?? "service"}
                    </span>
                    {c.spec?.image && (
                      <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                        {c.spec.image}
                      </span>
                    )}
                  </div>
                  {ports.length > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Icon
                        icon="icon-[ph--plug-duotone]"
                        className="text-xs"
                      />
                      {ports.map((p: any) => `${p.port}`).join(", ")}
                    </div>
                  )}
                  {deps.length > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Icon
                        icon="icon-[ph--arrow-bend-down-right-duotone]"
                        className="text-xs"
                      />
                      depends on: {deps.join(", ")}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </SystemLayout>
  )
}
