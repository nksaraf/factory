import { useState } from "react"

import { PlaneHeader, StatusBadge, EmptyState } from "@/components/factory"
import { useSubnets, useIpAddresses } from "@/lib/infra"

export default function NetworkPage() {
  const { data: subnets, isLoading } = useSubnets()
  const [expandedSubnet, setExpandedSubnet] = useState<string | null>(null)

  return (
    <div className="space-y-6 p-6">
      <PlaneHeader
        plane="infra"
        title="Network Topology"
        description="Subnets and IP address allocations"
      />

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {!isLoading && (subnets ?? []).length === 0 && (
        <EmptyState icon="icon-[ph--network-duotone]" title="No subnets" />
      )}

      <div className="space-y-3">
        {(subnets ?? []).map((s) => (
          <SubnetRow
            key={s.id}
            subnet={s}
            expanded={expandedSubnet === s.id}
            onToggle={() =>
              setExpandedSubnet(expandedSubnet === s.id ? null : s.id)
            }
          />
        ))}
      </div>
    </div>
  )
}

function SubnetRow({
  subnet,
  expanded,
  onToggle,
}: {
  subnet: {
    id: string
    cidr: string
    gateway: string | null
    vlanId: number | null
    vlanName: string | null
    subnetType: string
    description: string | null
  }
  expanded: boolean
  onToggle: () => void
}) {
  const { data: ips } = useIpAddresses(
    expanded ? { subnetId: subnet.id } : undefined
  )

  return (
    <div className="rounded-lg border bg-card">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between p-4 text-left"
      >
        <div>
          <span className="font-mono font-medium">{subnet.cidr}</span>
          {subnet.vlanName && (
            <span className="ml-3 text-xs text-muted-foreground">
              VLAN: {subnet.vlanName}
            </span>
          )}
          {subnet.vlanId != null && (
            <span className="ml-1 text-xs text-muted-foreground">
              ({subnet.vlanId})
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {subnet.subnetType}
          </span>
          <span
            className={`text-xs transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            ▼
          </span>
        </div>
      </button>

      {subnet.description && (
        <p className="px-4 pb-2 text-xs text-muted-foreground">
          {subnet.description}
        </p>
      )}

      {expanded && (
        <div className="border-t px-4 py-3">
          {subnet.gateway && (
            <p className="mb-2 text-xs text-muted-foreground">
              Gateway: <span className="font-mono">{subnet.gateway}</span>
            </p>
          )}

          {(ips ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No IP allocations</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-4">Address</th>
                  <th className="pb-2 pr-4">DNS Name</th>
                  <th className="pb-2 pr-4">Role</th>
                  <th className="pb-2 pr-4">Assigned To</th>
                  <th className="pb-2 pr-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {(ips ?? []).map((ip) => (
                  <tr key={ip.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-4 font-mono text-xs">
                      {ip.address}
                    </td>
                    <td className="py-1.5 pr-4 text-xs">{ip.dnsName ?? "—"}</td>
                    <td className="py-1.5 pr-4 text-xs">{ip.role ?? "—"}</td>
                    <td className="py-1.5 pr-4 text-xs">
                      {ip.assignedToKind ? `${ip.assignedToKind}` : "—"}
                    </td>
                    <td className="py-1.5 pr-4">
                      <StatusBadge status={ip.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
