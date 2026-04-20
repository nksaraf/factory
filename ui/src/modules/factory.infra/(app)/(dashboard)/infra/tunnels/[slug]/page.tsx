import { useTunnel } from "@/lib/infra"
import { useParams } from "react-router"

import { MetricCard, PageHeader, StatusBadge } from "@/components/factory"

import { InfraActionMenu } from "../../../../../components/infra-action-menu"

export default function TunnelDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: tunnel } = useTunnel(slug)

  if (!tunnel) return null

  const spec = tunnel.spec as Record<string, any>

  return (
    <div className="space-y-6">
      <PageHeader
        pageGroup="infra"
        title={tunnel.subdomain}
        description={`${tunnel.type} tunnel`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={tunnel.phase} />
            <InfraActionMenu entityPath="tunnels" entityId={tunnel.id} />
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <MetricCard label="Type" value={tunnel.type} plane="infra" />
        <MetricCard label="Phase" value={tunnel.phase} plane="infra" />
        <MetricCard
          label="Local Port"
          value={spec.localPort ?? "\u2014"}
          plane="infra"
        />
        <MetricCard
          label="Remote Port"
          value={spec.remotePort ?? "\u2014"}
          plane="infra"
        />
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h2 className="text-lg font-semibold">Details</h2>
          <div className="grid gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Route ID</span>
              <span className="font-mono">{tunnel.routeId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Principal ID</span>
              <span className="font-mono">{tunnel.principalId}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
