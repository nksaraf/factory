import { Link, useParams } from "react-router"

import { EmptyState, StatusBadge } from "@/components/factory"
import { useOpsSite, useSystemDeployments, useRollouts } from "@/lib/ops"

export default function SiteDeploymentsTab() {
  const { slug } = useParams<{ slug: string }>()
  const { data: site } = useOpsSite(slug)
  const { data: allDeployments } = useSystemDeployments()
  const { data: allRollouts } = useRollouts()

  if (!site) return null

  const siteDeploymentIds = new Set(
    (allDeployments ?? []).filter((d) => d.siteId === site.id).map((d) => d.id)
  )
  const siteRollouts = (allRollouts ?? [])
    .filter((r) => siteDeploymentIds.has(r.systemDeploymentId))
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .slice(0, 50)

  const deploymentMap = new Map(
    (allDeployments ?? []).map((d) => [d.id, d.name])
  )

  if (siteRollouts.length === 0) {
    return (
      <EmptyState
        icon="icon-[ph--rocket-launch-duotone]"
        title="No rollouts"
        description="No rollouts found for this site."
      />
    )
  }

  return (
    <div className="space-y-2">
      {siteRollouts.map((rollout) => {
        const status = (rollout.spec?.status as string) ?? "unknown"
        const strategy = (rollout.spec?.strategy as string) ?? "\u2014"
        const targetName =
          deploymentMap.get(rollout.systemDeploymentId) ??
          rollout.systemDeploymentId
        return (
          <Link
            key={rollout.id}
            to={`/ops/rollouts/${rollout.id}`}
            className="flex items-center justify-between rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50"
          >
            <div>
              <span className="font-medium text-base">{targetName}</span>
              <span className="ml-2 text-sm text-muted-foreground">
                {strategy} · {new Date(rollout.createdAt).toLocaleDateString()}
              </span>
            </div>
            <StatusBadge status={status} />
          </Link>
        )
      })}
    </div>
  )
}
