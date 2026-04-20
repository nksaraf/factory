import { useParams } from "react-router"

import { Icon } from "@rio.js/ui/icon"

import { MetricCard } from "@/components/factory"
import { useHost } from "@/lib/infra"
import { HostLayout } from "../host-layout"

export default function HostMonitoringTab() {
  const { slug } = useParams<{ slug: string }>()
  const { data: host } = useHost(slug)

  if (!host) return null

  const dxVersion = host.spec.dxVersion as string | undefined
  const lastPingAt = host.spec.lastPingAt as string | undefined

  return (
    <HostLayout>
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="DX Version"
            value={dxVersion ?? "Not installed"}
            plane="infra"
          />
          <MetricCard
            label="Last Ping"
            value={lastPingAt ? new Date(lastPingAt).toLocaleString() : "Never"}
            plane="infra"
          />
          <MetricCard
            label="CPU Capacity"
            value={host.spec.cpu ? `${host.spec.cpu}c` : "\u2014"}
            plane="infra"
          />
          <MetricCard
            label="Memory Capacity"
            value={
              host.spec.memoryMb
                ? `${Math.round((host.spec.memoryMb as number) / 1024)}G`
                : "\u2014"
            }
            plane="infra"
          />
        </div>

        <div className="rounded-lg border border-dashed bg-muted/30 p-12 text-center">
          <Icon
            icon="icon-[ph--chart-line-duotone]"
            className="text-4xl text-muted-foreground mx-auto mb-3"
          />
          <h3 className="text-lg font-semibold mb-1">Resource Monitoring</h3>
          <p className="text-base text-muted-foreground">
            CPU, memory, disk, and network utilization graphs will appear here
            once dx sentinel is streaming metrics from this host.
          </p>
        </div>
      </div>
    </HostLayout>
  )
}
