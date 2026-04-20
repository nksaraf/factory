import { Link, useParams } from "react-router"

import { Icon } from "@rio.js/ui/icon"

import { MetricCard, StatusBadge } from "@/components/factory"
import { useSystem, useSystemComponents } from "../../../../../data/use-build"
import { SystemLayout } from "./system-layout"

export default function SystemOverview() {
  const { slug } = useParams<{ slug: string }>()
  const { data: system } = useSystem(slug)
  const { data: components } = useSystemComponents(slug)

  if (!system) return null
  const spec = (system.spec ?? {}) as Record<string, unknown>
  const comps = components ?? []
  const types: Record<string, number> = {}
  for (const c of comps)
    types[c.type ?? "unknown"] = (types[c.type ?? "unknown"] ?? 0) + 1

  return (
    <SystemLayout>
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <MetricCard label="Components" value={comps.length} plane="build" />
          <MetricCard
            label="Owner Team"
            value={system.ownerTeamId ?? "\u2014"}
            plane="build"
          />
          <MetricCard
            label="Lifecycle"
            value={spec.lifecycle ?? system.lifecycle ?? "\u2014"}
            plane="build"
          />
          <MetricCard
            label="Type"
            value={system.type ?? "\u2014"}
            plane="build"
          />
        </div>

        {system.description && (
          <div>
            <h2 className="text-lg font-semibold mb-1">Description</h2>
            <p className="text-base text-muted-foreground">
              {system.description}
            </p>
          </div>
        )}

        <div>
          <h2 className="text-lg font-semibold mb-3">Component Types</h2>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(types)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => (
                <span
                  key={type}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-card text-sm"
                >
                  <Icon
                    icon="icon-[ph--puzzle-piece-duotone]"
                    className="text-sm text-muted-foreground"
                  />
                  <span className="font-medium">{type}</span>
                  <span className="text-muted-foreground font-mono">
                    {count}
                  </span>
                </span>
              ))}
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-3">Components</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {comps.slice(0, 12).map((c: any) => (
              <div
                key={c.id ?? c.slug}
                className="rounded-lg border bg-card p-3 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-base truncate">
                    {c.name ?? c.slug}
                  </span>
                  <StatusBadge
                    status={
                      typeof c.lifecycle === "string" ? c.lifecycle : "unknown"
                    }
                  />
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="px-1.5 py-0.5 rounded bg-muted font-mono">
                    {c.type ?? "service"}
                  </span>
                  {c.spec?.image && (
                    <span className="truncate">{c.spec.image}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          {comps.length > 12 && (
            <Link
              to={`/build/systems/${slug}/components`}
              className="mt-2 inline-block text-sm text-primary hover:underline"
            >
              View all {comps.length} components &rarr;
            </Link>
          )}
        </div>
      </div>
    </SystemLayout>
  )
}
