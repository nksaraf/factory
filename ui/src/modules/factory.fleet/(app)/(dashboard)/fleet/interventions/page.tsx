import { PlaneHeader, EmptyState } from "@/components/factory"
import { useInterventions, useDeploymentTargets } from "@/lib/fleet"

export default function InterventionsPage() {
  const { data: interventions, isLoading } = useInterventions()
  const { data: targets } = useDeploymentTargets()
  const targetMap = Object.fromEntries((targets ?? []).map((t) => [t.id, t]))

  return (
    <div className="space-y-6 p-6">
      <PlaneHeader plane="fleet" title="Intervention Log" description="Audit trail of manual actions on deployments" />

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {!isLoading && (interventions ?? []).length === 0 && (
        <EmptyState icon="icon-[ph--hand-duotone]" title="No interventions recorded" />
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="pb-2 pr-4">Action</th>
              <th className="pb-2 pr-4">Target</th>
              <th className="pb-2 pr-4">Principal</th>
              <th className="pb-2 pr-4">Reason</th>
              <th className="pb-2 pr-4">When</th>
            </tr>
          </thead>
          <tbody>
            {(interventions ?? []).map((i) => (
              <tr key={i.id} className="border-b last:border-0">
                <td className="py-2 pr-4 font-medium">{i.action}</td>
                <td className="py-2 pr-4">{targetMap[i.deploymentTargetId]?.name ?? i.deploymentTargetId}</td>
                <td className="py-2 pr-4">{i.principalId}</td>
                <td className="py-2 pr-4 text-muted-foreground">{i.reason}</td>
                <td className="py-2 pr-4 text-muted-foreground">{new Date(i.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
