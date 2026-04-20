import { useState } from "react"
import { Link } from "react-router"

import { Icon } from "@rio.js/ui/icon"

import { DashboardPage, EmptyState, StatusBadge } from "@/components/factory"
import { useTeams } from "../../../../data/use-org"

export default function TeamsPage() {
  const { data: teams, isLoading } = useTeams()
  const [search, setSearch] = useState("")

  const filtered = (teams ?? []).filter((t: any) => {
    if (!search) return true
    return (
      (t.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (t.slug ?? "").toLowerCase().includes(search.toLowerCase())
    )
  })

  const toolbar = (
    <input
      placeholder="Search teams..."
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      className="max-w-sm text-base px-3 py-2 rounded-md border bg-card text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
    />
  )

  return (
    <DashboardPage
      plane="agent"
      title="Teams"
      description="Organizational units, business areas, and product teams"
      toolbar={toolbar}
    >
      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {!isLoading && filtered.length === 0 && (
        <EmptyState icon="icon-[ph--users-duotone]" title="No teams found" />
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 content-start">
        {filtered.map((t: any) => (
          <Link
            key={t.id}
            to={`/org/teams/${t.slug ?? t.id}`}
            className="rounded-lg border bg-card p-4 hover:bg-accent/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Icon
                icon="icon-[ph--users-duotone]"
                className="text-2xl text-muted-foreground"
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-base">{t.name ?? t.slug}</div>
                <div className="text-sm text-muted-foreground">{t.slug}</div>
              </div>
              <StatusBadge status={t.type ?? "team"} />
            </div>
            {t.description && (
              <p className="mt-2 text-sm text-muted-foreground truncate">
                {t.description}
              </p>
            )}
          </Link>
        ))}
      </div>
    </DashboardPage>
  )
}
