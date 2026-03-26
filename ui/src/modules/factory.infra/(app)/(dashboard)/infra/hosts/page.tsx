import { useState } from "react"
import { Link } from "react-router"

import { Input } from "@rio.js/ui/input"

import { PlaneHeader, StatusBadge, EmptyState } from "@/components/factory"
import { useHosts, useVMs } from "@/lib/infra"

type Tab = "hosts" | "vms"

export default function HostsPage() {
  const [tab, setTab] = useState<Tab>("hosts")
  const [search, setSearch] = useState("")

  const { data: hosts, isLoading: hostsLoading } = useHosts()
  const { data: vms, isLoading: vmsLoading } = useVMs()

  const isLoading = tab === "hosts" ? hostsLoading : vmsLoading

  const filteredHosts = (hosts ?? []).filter((h) =>
    h.name.toLowerCase().includes(search.toLowerCase())
  )
  const filteredVMs = (vms ?? []).filter((v) =>
    v.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6 p-6">
      <PlaneHeader plane="infra" title="Host & VM Inventory" description="Bare-metal hosts and virtual machines" />

      <div className="flex items-center gap-4">
        <div className="flex gap-1 rounded-lg border bg-muted p-1">
          <button
            onClick={() => setTab("hosts")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === "hosts" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            Hosts ({(hosts ?? []).length})
          </button>
          <button
            onClick={() => setTab("vms")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === "vms" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            VMs ({(vms ?? []).length})
          </button>
        </div>
        <Input placeholder={`Search ${tab}...`} value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {tab === "hosts" && (
        <>
          {!hostsLoading && filteredHosts.length === 0 && <EmptyState icon="icon-[ph--hard-drives-duotone]" title="No hosts" />}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-4">Name</th>
                <th className="pb-2 pr-4">IP</th>
                <th className="pb-2 pr-4">OS</th>
                <th className="pb-2 pr-4">CPU / Mem / Disk</th>
                <th className="pb-2 pr-4">Status</th>
              </tr></thead>
              <tbody>{filteredHosts.map((h) => (
                <tr key={h.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium">{h.name}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{h.ipAddress ?? "—"}</td>
                  <td className="py-2 pr-4 text-xs">{h.osType}</td>
                  <td className="py-2 pr-4 text-xs">{h.cpuCores}c / {Math.round(h.memoryMb / 1024)}G / {h.diskGb}G</td>
                  <td className="py-2 pr-4"><StatusBadge status={h.status} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}

      {tab === "vms" && (
        <>
          {!vmsLoading && filteredVMs.length === 0 && <EmptyState icon="icon-[ph--desktop-duotone]" title="No VMs" />}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-4">Name</th>
                <th className="pb-2 pr-4">IP</th>
                <th className="pb-2 pr-4">Type</th>
                <th className="pb-2 pr-4">CPU / Mem / Disk</th>
                <th className="pb-2 pr-4">Status</th>
              </tr></thead>
              <tbody>{filteredVMs.map((v) => (
                <tr key={v.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium">{v.name}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{v.ipAddress ?? "—"}</td>
                  <td className="py-2 pr-4 text-xs">{v.vmType}</td>
                  <td className="py-2 pr-4 text-xs">{v.cpu}c / {Math.round(v.memoryMb / 1024)}G / {v.diskGb}G</td>
                  <td className="py-2 pr-4"><StatusBadge status={v.status} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
