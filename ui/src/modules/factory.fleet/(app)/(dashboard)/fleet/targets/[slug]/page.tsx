import { useDeploymentTargets, useWorkloads } from "@/lib/fleet"
import { useParams } from "react-router"

import {
  EmptyState,
  MetricCard,
  PlaneHeader,
  StatusBadge,
} from "@/components/factory"

export default function TargetDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: targets, isLoading } = useDeploymentTargets()
  const target = (targets ?? []).find((t) => t.slug === slug)
  const { data: workloads } = useWorkloads(target?.id)

  if (isLoading)
    return <p className="p-6 text-sm text-muted-foreground">Loading...</p>
  if (!target)
    return (
      <EmptyState
        title="Target not found"
        description={`No target with slug "${slug}"`}
      />
    )

  const running = (workloads ?? []).filter((w) => w.status === "running").length
  const drifted = (workloads ?? []).filter((w) => w.driftDetected).length

  return (
    <div className="space-y-6 p-6">
      <PlaneHeader
        plane="fleet"
        title={target.name}
        description={`${target.kind} · ${target.realm} · ${target.trigger}`}
        actions={<StatusBadge status={target.status} />}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <MetricCard
          label="Workloads"
          value={(workloads ?? []).length}
          plane="fleet"
        />
        <MetricCard label="Running" value={running} plane="fleet" />
        <MetricCard label="Drifted" value={drifted} plane="fleet" />
        <MetricCard
          label="Namespace"
          value={target.namespace ?? "—"}
          plane="fleet"
        />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Workloads</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-4">Component</th>
                <th className="pb-2 pr-4">Replicas</th>
                <th className="pb-2 pr-4">Desired Image</th>
                <th className="pb-2 pr-4">Actual Image</th>
                <th className="pb-2 pr-4">Drift</th>
                <th className="pb-2 pr-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {(workloads ?? []).map((w) => (
                <tr key={w.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium">{w.componentId}</td>
                  <td className="py-2 pr-4">{w.replicas}</td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {w.desiredImage.split(":").pop()}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {w.actualImage?.split(":").pop() ?? "—"}
                  </td>
                  <td className="py-2 pr-4">
                    {w.driftDetected && (
                      <span className="text-red-500 font-medium">DRIFT</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <StatusBadge status={w.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
