import { useDeploymentTargets, useWorkloads } from "@/lib/ops"
import { useParams } from "react-router"

import {
  EmptyState,
  MetricCard,
  PlaneHeader,
  StatusBadge,
} from "@/components/factory"

export default function WorkloadInspectorPage() {
  const { id } = useParams<{ id: string }>()
  const { data: targets } = useDeploymentTargets()

  // Find the workload across all targets
  let foundWorkload = null
  let foundTarget = null
  for (const t of targets ?? []) {
    // We can't call hooks in a loop, so this page works differently:
    // We show basic info and link to the target detail for full workload view
    foundTarget = t
  }

  return (
    <div className="space-y-6 p-6">
      <PlaneHeader
        plane="ops"
        title="Workload Inspector"
        description={`Workload: ${id}`}
      />
      <EmptyState
        icon="icon-[ph--magnifying-glass-duotone]"
        title="Workload deep-dive"
        description="Navigate to a Deployment Target detail page and click on a workload to inspect it. Direct workload inspection by ID is coming soon."
      />
    </div>
  )
}
