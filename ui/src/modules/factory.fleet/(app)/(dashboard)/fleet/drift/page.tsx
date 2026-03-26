import { Link } from "react-router"

import { PlaneHeader, StatusBadge, EmptyState } from "@/components/factory"
import { useDeploymentTargets, useWorkloads } from "@/lib/fleet"

function DriftSection({ targetId, targetName, targetSlug }: { targetId: string; targetName: string; targetSlug: string }) {
  const { data: workloads } = useWorkloads(targetId)
  const drifted = (workloads ?? []).filter((w) => w.driftDetected)

  if (drifted.length === 0) return null

  return (
    <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
      <Link to={`/fleet/targets/${targetSlug}`} className="font-medium hover:underline">
        {targetName}
      </Link>
      <span className="ml-2 text-xs text-red-400">{drifted.length} drifted</span>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-1 pr-4">Component</th>
              <th className="pb-1 pr-4">Desired</th>
              <th className="pb-1 pr-4">Actual</th>
              <th className="pb-1 pr-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {drifted.map((w) => (
              <tr key={w.id}>
                <td className="py-1 pr-4">{w.componentId}</td>
                <td className="py-1 pr-4 font-mono text-xs">{w.desiredImage.split(":").pop()}</td>
                <td className="py-1 pr-4 font-mono text-xs text-red-400">{w.actualImage?.split(":").pop() ?? "unknown"}</td>
                <td className="py-1 pr-4"><StatusBadge status={w.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function DriftReportPage() {
  const { data: targets, isLoading } = useDeploymentTargets()

  return (
    <div className="space-y-6 p-6">
      <PlaneHeader plane="fleet" title="Drift Report" description="Workloads where desired state ≠ actual state" />

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {!isLoading && (targets ?? []).length === 0 && (
        <EmptyState icon="icon-[ph--git-diff-duotone]" title="No deployment targets" />
      )}

      <div className="space-y-4">
        {(targets ?? []).map((t) => (
          <DriftSection key={t.id} targetId={t.id} targetName={t.name} targetSlug={t.slug} />
        ))}
      </div>
    </div>
  )
}
