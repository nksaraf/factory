import { useState } from "react"

import { Icon } from "@rio.js/ui/icon"

import { DashboardPage, EmptyState, StatusBadge } from "@/components/factory"
import { useRepos } from "../../../../data/use-build"

export default function ReposPage() {
  const { data: repos, isLoading } = useRepos()
  const [search, setSearch] = useState("")

  const filtered = (repos ?? []).filter((r: any) => {
    if (!search) return true
    const q = search.toLowerCase()
    const name = (r.name ?? r.slug ?? "").toLowerCase()
    return name.includes(q) || (r.slug ?? "").toLowerCase().includes(q)
  })

  const toolbar = (
    <input
      placeholder="Search repos..."
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      className="max-w-sm text-base px-3 py-2 rounded-md border bg-card text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
    />
  )

  return (
    <DashboardPage
      plane="build"
      title="Repos"
      description="Git repositories tracked by Factory"
      toolbar={toolbar}
    >
      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading repos...</p>
      )}
      {!isLoading && filtered.length === 0 && (
        <EmptyState
          icon="icon-[ph--git-branch-duotone]"
          title="No repos found"
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 content-start">
        {filtered.map((repo: any) => (
          <div
            key={repo.id ?? repo.slug}
            className="rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <Icon
                  icon="icon-[ph--git-branch-duotone]"
                  className="text-lg text-muted-foreground"
                />
                <h3 className="font-medium text-base">
                  {repo.name ?? repo.slug}
                </h3>
              </div>
              <StatusBadge status={repo.status ?? repo.syncStatus} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground truncate">
              {repo.slug}
            </p>
            {repo.gitUrl && (
              <p className="mt-1 text-xs text-muted-foreground truncate font-mono">
                {repo.gitUrl}
              </p>
            )}
            {repo.defaultBranch && (
              <p className="mt-2 text-xs text-muted-foreground">
                <Icon
                  icon="icon-[ph--git-commit-duotone]"
                  className="text-sm inline mr-1"
                />
                {repo.defaultBranch}
              </p>
            )}
          </div>
        ))}
      </div>
    </DashboardPage>
  )
}
