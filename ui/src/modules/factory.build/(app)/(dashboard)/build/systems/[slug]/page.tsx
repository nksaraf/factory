import { Link, useParams } from "react-router"

import { Icon } from "@rio.js/ui/icon"

import { cn } from "@rio.js/ui/lib/utils"

import { MetricCard, StatusBadge } from "@/components/factory"
import { useSystem, useSystemComponents } from "../../../../../data/use-build"
import {
  COMPONENT_KIND_COLOR,
  COMPONENT_KIND_ICON,
  inferComponentKind,
} from "../../../../../data/component-kind"
import { useTeams } from "../../../../../../factory.org/data/use-org"
import { SystemLayout } from "./system-layout"

export default function SystemOverview() {
  const { slug } = useParams<{ slug: string }>()
  const { data: system } = useSystem(slug)
  const { data: components } = useSystemComponents(slug)
  const { data: teams } = useTeams()

  if (!system) return null
  const spec = (system.spec ?? {}) as Record<string, unknown>
  const ownerTeam = teams?.find((t: any) => t.id === system.ownerTeamId)
  const comps = components ?? []
  const types: Record<string, number> = {}
  for (const c of comps) {
    const kind = inferComponentKind(c)
    types[kind] = (types[kind] ?? 0) + 1
  }

  return (
    <SystemLayout>
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <MetricCard label="Components" value={comps.length} plane="build" />
          <MetricCard
            label="Owner Team"
            value={ownerTeam?.name ?? ownerTeam?.slug ?? "\u2014"}
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
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 text-sm",
                    COMPONENT_KIND_COLOR[type] ?? "border-zinc-300 bg-card"
                  )}
                >
                  <Icon
                    icon={
                      COMPONENT_KIND_ICON[type] ?? "icon-[ph--cube-duotone]"
                    }
                    className="text-sm text-foreground/70"
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
                className={cn(
                  "rounded-lg border-2 p-3 hover:bg-accent/50 transition-colors",
                  COMPONENT_KIND_COLOR[inferComponentKind(c)] ??
                    "border-zinc-300 bg-card"
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 truncate">
                    <Icon
                      icon={
                        COMPONENT_KIND_ICON[inferComponentKind(c)] ??
                        "icon-[ph--cube-duotone]"
                      }
                      className="text-base text-foreground/70 shrink-0"
                    />
                    <span className="font-medium text-base truncate">
                      {c.name ?? c.slug}
                    </span>
                  </div>
                  <StatusBadge
                    status={
                      typeof c.lifecycle === "string" ? c.lifecycle : "unknown"
                    }
                  />
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="px-1.5 py-0.5 rounded bg-background/80 font-mono">
                    {inferComponentKind(c)}
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
