import { Link, useParams } from "react-router"

import { Icon } from "@rio.js/ui/icon"

import {
  EmptyState,
  MetricCard,
  PageHeader,
  StatusBadge,
} from "@/components/factory"

import { useTeam, useTeamMembers } from "../../../../../data/use-org"

export default function TeamDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: team, isLoading } = useTeam(slug)
  const { data: members } = useTeamMembers(slug)

  if (isLoading)
    return <p className="p-6 text-sm text-muted-foreground">Loading...</p>
  if (!team)
    return (
      <EmptyState
        title="Team not found"
        description={`No team with slug "${slug}"`}
      />
    )

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        pageGroup="agent"
        title={team.name ?? team.slug}
        description={team.description ?? team.slug}
        actions={<StatusBadge status={team.type ?? "team"} />}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          label="Members"
          value={(members ?? []).length}
          plane="agent"
        />
        <MetricCard label="Type" value={team.type ?? "\u2014"} plane="agent" />
        <MetricCard
          label="Parent"
          value={team.parentTeamId ?? "\u2014"}
          plane="agent"
        />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Members</h2>
        {!members || members.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No members in this team.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((m: any) => (
              <Link
                key={m.id}
                to={`/org/principals/${m.principalSlug ?? m.principalId}`}
                className="flex items-center gap-3 rounded-lg border bg-card p-3 hover:bg-accent/50 transition-colors"
              >
                <Icon
                  icon="icon-[ph--user-circle-duotone]"
                  className="text-2xl text-muted-foreground"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-base">
                    {m.principalName ?? m.principalSlug ?? m.principalId}
                  </div>
                  <div className="text-xs text-muted-foreground">{m.role}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
