import { Link, useParams } from "react-router"

import { Icon } from "@rio.js/ui/icon"

import { MetricCard, StatusBadge } from "@/components/factory"
import { useHostRaw as useHost, useRealms } from "@/lib/infra"
import { REALM_TYPE_ICONS } from "../../../../../components/type-icons"
import { CopyCell } from "../../../../../components/copy-cell"
import { HostLayout } from "./host-layout"

function formatMem(mb: unknown): string {
  const val = Number(mb) || 0
  return val > 0 ? `${Math.round(val / 1024)}G` : "\u2014"
}

function formatDisk(gb: unknown): string {
  const val = Number(gb) || 0
  return val > 0 ? `${val}G` : "\u2014"
}

function formatCpu(cpu: unknown): string {
  const val = Number(cpu) || 0
  return val > 0 ? `${val}c` : "\u2014"
}

export default function HostOverviewTab() {
  const { slug } = useParams<{ slug: string }>()
  const { data: host } = useHost(slug)
  const { data: allRealms } = useRealms()

  if (!host) return null

  const os = (host.spec.os as string) ?? "\u2014"
  const arch = (host.spec.arch as string) ?? "\u2014"
  const ipAddress = host.spec.ipAddress as string | undefined

  const hostRealms = (allRealms ?? []).filter(
    (r) =>
      (r.spec.hostId as string) === host.id ||
      (r.spec.hostSlug as string) === host.slug
  )

  return (
    <HostLayout>
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <MetricCard label="OS" value={os} plane="infra" />
          <MetricCard label="Arch" value={arch} plane="infra" />
          <MetricCard
            label="CPU"
            value={formatCpu(host.spec.cpu)}
            plane="infra"
          />
          <MetricCard
            label="Memory"
            value={formatMem(host.spec.memoryMb)}
            plane="infra"
          />
          <MetricCard
            label="Disk"
            value={formatDisk(host.spec.diskGb)}
            plane="infra"
          />
          <MetricCard label="IP" value={ipAddress ?? "\u2014"} plane="infra" />
        </div>

        {ipAddress && (
          <div>
            <h2 className="mb-2 text-lg font-semibold">IP Address</h2>
            <CopyCell value={ipAddress} />
          </div>
        )}

        {hostRealms.length > 0 && (
          <div>
            <h2 className="mb-3 text-lg font-semibold">Realms</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {hostRealms.map((realm) => (
                <Link
                  key={realm.id}
                  to={`/infra/realms/${realm.slug}`}
                  className="rounded-lg border bg-card p-3 hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon
                        icon={
                          REALM_TYPE_ICONS[realm.type] ??
                          "icon-[ph--gear-six-duotone]"
                        }
                        className="text-base text-muted-foreground"
                      />
                      <span className="font-medium text-base">
                        {realm.name}
                      </span>
                    </div>
                    <StatusBadge
                      status={(realm.spec.status as string) ?? "unknown"}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {realm.type}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </HostLayout>
  )
}
