import { useDnsDomain } from "@/lib/infra"
import { useParams } from "react-router"

import { MetricCard, PageHeader, StatusBadge } from "@/components/factory"

import { InfraActionMenu } from "../../../../../components/infra-action-menu"

export default function DnsDomainDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: domain } = useDnsDomain(slug)

  if (!domain) return null

  const spec = domain.spec as Record<string, any>
  const verified = spec.verified as boolean | undefined
  const records = spec.records as Array<Record<string, any>> | undefined

  return (
    <div className="space-y-6">
      <PageHeader
        pageGroup="infra"
        title={domain.name}
        description={domain.fqdn}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={verified ? "verified" : "unverified"} />
            <InfraActionMenu entityPath="dns-domains" entityId={domain.id} />
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard label="Type" value={domain.type} plane="infra" />
        <MetricCard
          label="Provider"
          value={(spec.dnsProvider as string) ?? "\u2014"}
          plane="infra"
        />
        <MetricCard
          label="Registrar"
          value={(spec.registrar as string) ?? "\u2014"}
          plane="infra"
        />
        <MetricCard
          label="Verified"
          value={verified ? "Yes" : "No"}
          plane="infra"
        />
        <MetricCard
          label="Records Count"
          value={records?.length ?? 0}
          plane="infra"
        />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">DNS Records</h2>
        {records && records.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Value</th>
                  <th className="px-4 py-2">TTL</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record, i) => (
                  <tr
                    key={i}
                    className="border-b last:border-0 hover:bg-accent/30"
                  >
                    <td className="px-4 py-2 font-mono text-xs">
                      {(record.type as string) ?? "\u2014"}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {(record.name as string) ?? "\u2014"}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs max-w-xs truncate">
                      {(record.value as string) ?? "\u2014"}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {record.ttl !== undefined ? record.ttl : "\u2014"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No DNS records found.</p>
        )}
      </div>
    </div>
  )
}
