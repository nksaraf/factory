import {
  useComponentDeployments,
  useRollouts,
  useSystemDeployment,
} from "@/lib/ops"
import { Link, useParams } from "react-router"

import {
  EmptyState,
  MetricCard,
  PageHeader,
  StatusBadge,
} from "@/components/factory"

export default function SystemDeploymentDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: deployment, isLoading } = useSystemDeployment(slug)
  const { data: allComponents } = useComponentDeployments()
  const { data: allRollouts } = useRollouts()

  if (isLoading)
    return <p className="p-6 text-sm text-muted-foreground">Loading...</p>
  if (!deployment)
    return (
      <EmptyState
        title="Deployment not found"
        description={`No system deployment with slug "${slug}"`}
      />
    )

  const phase = (deployment.status?.phase as string) ?? "unknown"
  const runtime = (deployment.spec?.runtime as string) ?? "\u2014"
  const strategy = (deployment.spec?.deploymentStrategy as string) ?? "\u2014"
  const trigger = (deployment.spec?.trigger as string) ?? "\u2014"
  const namespace = (deployment.spec?.namespace as string) ?? "\u2014"

  const components = (allComponents ?? []).filter(
    (c) => c.systemDeploymentId === deployment.id
  )
  const rollouts = (allRollouts ?? [])
    .filter((r) => r.systemDeploymentId === deployment.id)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .slice(0, 10)

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        pageGroup="ops"
        title={deployment.name}
        description={`${deployment.type} system deployment`}
        actions={<StatusBadge status={phase} />}
      />

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard label="Type" value={deployment.type} plane="ops" />
        <MetricCard label="Runtime" value={runtime} plane="ops" />
        <MetricCard label="Strategy" value={strategy} plane="ops" />
        <MetricCard label="Trigger" value={trigger} plane="ops" />
        <MetricCard label="Namespace" value={namespace} plane="ops" />
      </div>

      {components.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">
            Component Deployments ({components.length})
          </h2>
          <div className="space-y-2">
            {components.map((comp) => {
              const compPhase = (comp.status?.phase as string) ?? "unknown"
              const image = (comp.spec?.desiredImage as string) ?? "\u2014"
              const replicas = (comp.spec?.replicas as number) ?? 1
              return (
                <Link
                  key={comp.id}
                  to={`/ops/component-deployments/${comp.id}`}
                  className="flex items-center justify-between rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50"
                >
                  <div>
                    <span className="font-medium text-base">
                      {comp.componentId}
                    </span>
                    <span className="ml-2 text-sm text-muted-foreground">
                      {replicas} replica{replicas !== 1 ? "s" : ""} · {image}
                    </span>
                  </div>
                  <StatusBadge status={compPhase} />
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {rollouts.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Recent Rollouts</h2>
          <div className="space-y-2">
            {rollouts.map((r) => {
              const rStatus = (r.spec?.status as string) ?? "unknown"
              const rStrategy = (r.spec?.strategy as string) ?? "\u2014"
              return (
                <Link
                  key={r.id}
                  to={`/ops/rollouts/${r.id}`}
                  className="flex items-center justify-between rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50"
                >
                  <div>
                    <span className="font-medium text-base">Rollout</span>
                    <span className="ml-2 text-sm text-muted-foreground">
                      {rStrategy} · {new Date(r.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <StatusBadge status={rStatus} />
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
