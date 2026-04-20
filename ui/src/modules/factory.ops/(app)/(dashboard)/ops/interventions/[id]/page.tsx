import { useIntervention } from "@/lib/ops"
import { useParams } from "react-router"

import {
  EmptyState,
  MetricCard,
  PageHeader,
  StatusBadge,
} from "@/components/factory"

export default function InterventionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: intervention, isLoading } = useIntervention(id)

  if (isLoading)
    return <p className="p-6 text-sm text-muted-foreground">Loading...</p>
  if (!intervention)
    return (
      <EmptyState
        title="Intervention not found"
        description={`No intervention with ID "${id}"`}
      />
    )

  const reason = (intervention.spec?.reason as string) ?? "\u2014"
  const result = (intervention.spec?.result as string) ?? "unknown"
  const actor = (intervention.spec?.actorPrincipalId as string) ?? "\u2014"
  const executedAt = intervention.spec?.executedAt
    ? new Date(intervention.spec.executedAt as string).toLocaleString()
    : "\u2014"

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        pageGroup="ops"
        title={`${intervention.type} Intervention`}
        description="Manual operational intervention"
        actions={<StatusBadge status={result} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Type" value={intervention.type} plane="ops" />
        <MetricCard label="Result" value={result} plane="ops" />
        <MetricCard label="Actor" value={actor} plane="ops" />
        <MetricCard label="Executed" value={executedAt} plane="ops" />
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold">Reason</h2>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-base">{reason}</p>
        </div>
      </div>
    </div>
  )
}
