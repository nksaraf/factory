import { useRoute } from "@/lib/infra"
import { useParams } from "react-router"

import { MetricCard, PageHeader, StatusBadge } from "@/components/factory"

export default function RouteDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: route } = useRoute(slug)

  if (!route) return null

  const spec = route.spec as Record<string, any>
  const targets = spec.targets as Array<Record<string, any>> | undefined

  return (
    <div className="space-y-6">
      <PageHeader
        pageGroup="infra"
        title={route.name}
        description={route.domain}
        actions={
          spec.status ? (
            <StatusBadge status={spec.status as string} />
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard label="Type" value={route.type} plane="infra" />
        <MetricCard label="Domain" value={route.domain} plane="infra" />
        <MetricCard
          label="Protocol"
          value={(spec.protocol as string) ?? "\u2014"}
          plane="infra"
        />
        <MetricCard
          label="Status"
          value={(spec.status as string) ?? "\u2014"}
          plane="infra"
        />
        <MetricCard
          label="TLS Mode"
          value={(spec.tlsMode as string) ?? "\u2014"}
          plane="infra"
        />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Targets</h2>
        {targets && targets.length > 0 ? (
          <div className="space-y-2">
            {targets.map((target, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg border bg-card p-3"
              >
                <div className="text-sm">
                  <span className="font-medium">
                    {(target.service as string) ??
                      (target.host as string) ??
                      "Unknown"}
                  </span>
                  {target.port && (
                    <span className="ml-2 text-muted-foreground">
                      :{target.port}
                    </span>
                  )}
                </div>
                {target.weight !== undefined && (
                  <span className="text-xs text-muted-foreground">
                    weight: {target.weight}
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : spec.targetService || spec.targetPort ? (
          <div className="rounded-lg border bg-card p-3 text-sm">
            <span className="font-medium">{spec.targetService as string}</span>
            {spec.targetPort && (
              <span className="ml-2 text-muted-foreground">
                :{spec.targetPort}
              </span>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No targets configured.
          </p>
        )}
      </div>
    </div>
  )
}
