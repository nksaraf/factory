import { useState } from "react"

import { Icon } from "@rio.js/ui/icon"

import { DashboardPage, EmptyState, StatusBadge } from "@/components/factory"
import { useComponents } from "../../../../data/use-build"

export default function ComponentsPage() {
  const { data: components, isLoading } = useComponents()
  const [search, setSearch] = useState("")

  const filtered = (components ?? []).filter((c: any) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (c.name ?? "").toLowerCase().includes(q) ||
      (c.slug ?? "").toLowerCase().includes(q) ||
      (c.type ?? "").toLowerCase().includes(q)
    )
  })

  const toolbar = (
    <input
      placeholder="Search components..."
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      className="max-w-sm text-base px-3 py-2 rounded-md border bg-card text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
    />
  )

  return (
    <DashboardPage
      plane="build"
      title="Components"
      description="All software components across systems"
      toolbar={toolbar}
    >
      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading components...</p>
      )}
      {!isLoading && filtered.length === 0 && (
        <EmptyState
          icon="icon-[ph--puzzle-piece-duotone]"
          title="No components found"
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 content-start">
        {filtered.map((comp: any) => (
          <div
            key={comp.id ?? comp.slug}
            className="rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <Icon
                  icon="icon-[ph--puzzle-piece-duotone]"
                  className="text-lg text-muted-foreground"
                />
                <h3 className="font-medium text-base">
                  {comp.name ?? comp.slug}
                </h3>
              </div>
              <StatusBadge status={comp.lifecycle ?? comp.status} />
            </div>
            {comp.type && (
              <span className="mt-1 inline-block text-xs font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {comp.type}
              </span>
            )}
            <p className="mt-1 text-sm text-muted-foreground truncate">
              {comp.slug}
            </p>
            {comp.systemId && (
              <p className="mt-2 text-xs text-muted-foreground">
                <Icon
                  icon="icon-[ph--stack-duotone]"
                  className="text-sm inline mr-1"
                />
                System: {comp.systemId}
              </p>
            )}
          </div>
        ))}
      </div>
    </DashboardPage>
  )
}
