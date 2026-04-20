import { useComponentDeployment } from "@/lib/ops"
import { useParams } from "react-router"

import {
  EmptyState,
  MetricCard,
  PageHeader,
  StatusBadge,
} from "@/components/factory"

import { OpsActionMenu } from "../../../../../components/ops-action-menu"

export default function ComponentDeploymentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: comp, isLoading } = useComponentDeployment(id)

  if (isLoading)
    return <p className="p-6 text-sm text-muted-foreground">Loading...</p>
  if (!comp)
    return (
      <EmptyState
        title="Component not found"
        description={`No component deployment with ID "${id}"`}
      />
    )

  const phase = (comp.status?.phase as string) ?? "unknown"
  const image = (comp.spec?.desiredImage as string) ?? "\u2014"
  const actualImage = (comp.status?.actualImage as string) ?? "\u2014"
  const replicas = (comp.spec?.replicas as number) ?? 1
  const mode = (comp.spec?.mode as string) ?? "deployed"
  const driftDetected = (comp.status?.driftDetected as boolean) ?? false
  const endpoint = (comp.status?.resolvedEndpoint as string) ?? "\u2014"

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        pageGroup="ops"
        title={comp.componentId}
        description="Component deployment"
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={phase} />
            <OpsActionMenu
              entityPath="component-deployments"
              entityId={comp.id}
            />
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="Phase" value={phase} plane="ops" />
        <MetricCard label="Replicas" value={replicas} plane="ops" />
        <MetricCard label="Mode" value={mode} plane="ops" />
        <MetricCard
          label="Drift"
          value={driftDetected ? "Yes" : "No"}
          plane="ops"
        />
        <MetricCard label="Endpoint" value={endpoint} plane="ops" />
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold">Images</h2>
        <div className="space-y-2">
          <div className="rounded-lg border bg-card p-3">
            <p className="text-sm text-muted-foreground">Desired</p>
            <p className="font-mono text-base break-all">{image}</p>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <p className="text-sm text-muted-foreground">Actual</p>
            <p className="font-mono text-base break-all">{actualImage}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
