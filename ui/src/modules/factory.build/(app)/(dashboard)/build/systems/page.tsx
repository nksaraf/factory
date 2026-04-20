import { useState } from "react"
import { Link } from "react-router"

import { Icon } from "@rio.js/ui/icon"

import { DashboardPage, EmptyState, StatusBadge } from "@/components/factory"
import { useSystems } from "../../../../data/use-build"

export default function SystemsPage() {
  const { data: systems, isLoading } = useSystems()
  const [search, setSearch] = useState("")

  const filtered = (systems ?? []).filter((s: any) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (s.name ?? "").toLowerCase().includes(q) ||
      (s.slug ?? "").toLowerCase().includes(q)
    )
  })

  const toolbar = (
    <input
      placeholder="Search systems..."
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      className="max-w-sm text-base px-3 py-2 rounded-md border bg-card text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
    />
  )

  return (
    <DashboardPage
      plane="build"
      title="Systems"
      description="Software systems in the catalog"
      toolbar={toolbar}
    >
      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading systems...</p>
      )}
      {!isLoading && filtered.length === 0 && (
        <EmptyState icon="icon-[ph--stack-duotone]" title="No systems found" />
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 content-start">
        {filtered.map((sys: any) => (
          <Link
            key={sys.id ?? sys.slug}
            to={`/build/systems/${sys.slug}`}
            className="block rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <Icon
                  icon="icon-[ph--stack-duotone]"
                  className="text-lg text-muted-foreground"
                />
                <h3 className="font-medium text-base">
                  {sys.name ?? sys.slug}
                </h3>
              </div>
              <StatusBadge status={sys.lifecycle ?? sys.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{sys.slug}</p>
            {sys.description && (
              <p className="mt-1 text-sm text-muted-foreground truncate">
                {sys.description}
              </p>
            )}
            {sys.ownerTeamId && (
              <p className="mt-2 text-xs text-muted-foreground">
                <Icon
                  icon="icon-[ph--users-duotone]"
                  className="text-sm inline mr-1"
                />
                {sys.ownerTeamId}
              </p>
            )}
          </Link>
        ))}
      </div>
    </DashboardPage>
  )
}
