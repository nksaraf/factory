import { useService } from "@/lib/infra"
import { useParams } from "react-router"

import { MetricCard, PageHeader, StatusBadge } from "@/components/factory"

export default function ServiceDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: service } = useService(slug)

  if (!service) return null

  const spec = service.spec as Record<string, any>
  const billing = spec.billing as Record<string, any> | undefined

  return (
    <div className="space-y-6">
      <PageHeader
        pageGroup="infra"
        title={service.name}
        description={service.type}
        actions={<StatusBadge status={service.type} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Type" value={service.type} plane="infra" />
        <MetricCard
          label="Provider"
          value={(spec.provider as string) ?? "\u2014"}
          plane="infra"
        />
        <MetricCard
          label="Version"
          value={(spec.version as string) ?? "\u2014"}
          plane="infra"
        />
        <MetricCard
          label="Protocol"
          value={(spec.protocol as string) ?? "\u2014"}
          plane="infra"
        />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Endpoint</h2>
        {spec.endpoint ? (
          <p className="rounded-lg border bg-card p-3 font-mono text-sm">
            {spec.endpoint as string}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            No endpoint configured.
          </p>
        )}
      </div>

      {billing && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Billing</h2>
          <div className="rounded-lg border bg-card p-4 space-y-2 text-sm">
            {billing.plan && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Plan</span>
                <span className="font-medium">{billing.plan}</span>
              </div>
            )}
            {billing.cost && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cost</span>
                <span className="font-medium">{billing.cost}</span>
              </div>
            )}
            {billing.cycle && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cycle</span>
                <span className="font-medium">{billing.cycle}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
