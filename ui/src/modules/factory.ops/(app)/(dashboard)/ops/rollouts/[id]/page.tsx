import { useRollout } from "@/lib/ops"
import { useParams } from "react-router"

import {
  EmptyState,
  MetricCard,
  PageHeader,
  StatusBadge,
} from "@/components/factory"

export default function RolloutDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: rollout, isLoading } = useRollout(id)

  if (isLoading)
    return <p className="p-6 text-sm text-muted-foreground">Loading...</p>
  if (!rollout)
    return (
      <EmptyState
        title="Rollout not found"
        description={`No rollout with ID "${id}"`}
      />
    )

  const status = (rollout.spec?.status as string) ?? "unknown"
  const strategy = (rollout.spec?.strategy as string) ?? "\u2014"
  const progress = (rollout.spec?.progress as number) ?? 0
  const startedAt = rollout.spec?.startedAt
    ? new Date(rollout.spec.startedAt as string).toLocaleString()
    : "\u2014"
  const completedAt = rollout.spec?.completedAt
    ? new Date(rollout.spec.completedAt as string).toLocaleString()
    : "\u2014"
  const error = (rollout.spec?.error as string) ?? null

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        pageGroup="ops"
        title="Rollout"
        description={`${strategy} rollout`}
        actions={<StatusBadge status={status} />}
      />

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard label="Status" value={status} plane="ops" />
        <MetricCard label="Strategy" value={strategy} plane="ops" />
        <MetricCard label="Progress" value={`${progress}%`} plane="ops" />
        <MetricCard label="Started" value={startedAt} plane="ops" />
        <MetricCard label="Completed" value={completedAt} plane="ops" />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm font-medium text-red-800 dark:text-red-200">
            Error
          </p>
          <p className="text-base text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}
    </div>
  )
}
