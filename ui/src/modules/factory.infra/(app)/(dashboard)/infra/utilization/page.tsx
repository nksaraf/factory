import { PlaneHeader, HealthGauge, MetricCard } from "@/components/factory"
import { useHosts, useVMs } from "@/lib/infra"

export default function UtilizationPage() {
  const { data: hosts, isLoading: hostsLoading } = useHosts()
  const { data: vms, isLoading: vmsLoading } = useVMs()

  const isLoading = hostsLoading || vmsLoading

  const totalCpu = (hosts ?? []).reduce((sum, h) => sum + h.cpuCores, 0)
  const totalMemGb = (hosts ?? []).reduce((sum, h) => sum + Math.round(h.memoryMb / 1024), 0)
  const totalDiskGb = (hosts ?? []).reduce((sum, h) => sum + h.diskGb, 0)

  const allocatedCpu = (vms ?? []).reduce((sum, v) => sum + v.cpu, 0)
  const allocatedMemGb = (vms ?? []).reduce((sum, v) => sum + Math.round(v.memoryMb / 1024), 0)
  const allocatedDiskGb = (vms ?? []).reduce((sum, v) => sum + v.diskGb, 0)

  const cpuPct = totalCpu > 0 ? Math.round((allocatedCpu / totalCpu) * 100) : 0
  const memPct = totalMemGb > 0 ? Math.round((allocatedMemGb / totalMemGb) * 100) : 0
  const diskPct = totalDiskGb > 0 ? Math.round((allocatedDiskGb / totalDiskGb) * 100) : 0

  return (
    <div className="space-y-6 p-6">
      <PlaneHeader plane="infra" title="Resource Utilization" description="Aggregate resource allocation across all hosts" />

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {!isLoading && (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <MetricCard label="Total Hosts" value={(hosts ?? []).length} plane="infra" />
            <MetricCard label="Total VMs" value={(vms ?? []).length} plane="infra" />
            <MetricCard label="Total CPU Cores" value={totalCpu} plane="infra" />
            <MetricCard label="Total Memory" value={`${totalMemGb} GB`} plane="infra" />
          </div>

          <div className="grid gap-6 sm:grid-cols-3">
            <div className="space-y-2 rounded-lg border bg-card p-4">
              <h3 className="text-sm font-medium">CPU Allocation</h3>
              <HealthGauge value={cpuPct} label={`${allocatedCpu} / ${totalCpu} cores`} />
            </div>
            <div className="space-y-2 rounded-lg border bg-card p-4">
              <h3 className="text-sm font-medium">Memory Allocation</h3>
              <HealthGauge value={memPct} label={`${allocatedMemGb} / ${totalMemGb} GB`} />
            </div>
            <div className="space-y-2 rounded-lg border bg-card p-4">
              <h3 className="text-sm font-medium">Disk Allocation</h3>
              <HealthGauge value={diskPct} label={`${allocatedDiskGb} / ${totalDiskGb} GB`} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
