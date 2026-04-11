import { useDeploymentTargets, useReleases, useRollouts } from "@/lib/ops"

import {
  EmptyState,
  PlaneHeader,
  StatusBadge,
  TimelineView,
} from "@/components/factory"

export default function RolloutsPage() {
  const { data: rollouts, isLoading } = useRollouts()
  const { data: releases } = useReleases()
  const { data: targets } = useDeploymentTargets()

  const releaseMap = Object.fromEntries((releases ?? []).map((r) => [r.id, r]))
  const targetMap = Object.fromEntries((targets ?? []).map((t) => [t.id, t]))

  const active = (rollouts ?? []).filter(
    (r) => r.status === "pending" || r.status === "in_progress"
  )
  const completed = (rollouts ?? []).filter(
    (r) => r.status !== "pending" && r.status !== "in_progress"
  )

  const toTimelineEntries = (items: typeof active) =>
    items.map((r) => ({
      id: r.id,
      label: `${releaseMap[r.releaseId]?.version ?? r.releaseId} → ${targetMap[r.deploymentTargetId]?.name ?? r.deploymentTargetId}`,
      timestamp: new Date(r.startedAt).toLocaleString(),
      status:
        r.status === "succeeded"
          ? ("complete" as const)
          : r.status === "in_progress"
            ? ("active" as const)
            : r.status === "failed" || r.status === "rolled_back"
              ? ("error" as const)
              : ("pending" as const),
    }))

  return (
    <div className="space-y-6 p-6">
      <PlaneHeader
        plane="ops"
        title="Rollout Tracker"
        description="Active and recent deployment rollouts"
      />

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {active.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Active Rollouts</h2>
          <TimelineView entries={toTimelineEntries(active)} />
        </div>
      )}

      {completed.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">History</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-4">Release</th>
                  <th className="pb-2 pr-4">Target</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Started</th>
                  <th className="pb-2 pr-4">Completed</th>
                </tr>
              </thead>
              <tbody>
                {completed.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-mono">
                      {releaseMap[r.releaseId]?.version ?? r.releaseId}
                    </td>
                    <td className="py-2 pr-4">
                      {targetMap[r.deploymentTargetId]?.name ??
                        r.deploymentTargetId}
                    </td>
                    <td className="py-2 pr-4">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {new Date(r.startedAt).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {r.completedAt
                        ? new Date(r.completedAt).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!isLoading && (rollouts ?? []).length === 0 && (
        <EmptyState
          icon="icon-[ph--arrow-circle-up-duotone]"
          title="No rollouts yet"
        />
      )}
    </div>
  )
}
