import { Link, useParams } from "react-router"

import { Icon } from "@rio.js/ui/icon"

import { MetricCard, StatusBadge } from "@/components/factory"
import { useOpsSite, useSystemDeployments } from "@/lib/ops"
import { SYSTEM_DEPLOYMENT_TYPE_ICONS } from "../../../../../components/type-icons"
import { SiteLayout } from "./site-layout"

export default function SiteOverviewTab() {
  const { slug } = useParams<{ slug: string }>()
  const { data: site } = useOpsSite(slug)
  const { data: allDeployments } = useSystemDeployments()

  if (!site) return null

  const phase = (site.status?.phase as string) ?? "unknown"
  const product = (site.spec?.product as string) ?? "—"
  const tenancy = (site.spec?.tenancy as string) ?? "—"
  const lifecycle = (site.spec?.lifecycle as string) ?? "persistent"

  const siteDeployments = (allDeployments ?? []).filter(
    (d) => d.siteId === site.id
  )

  return (
    <SiteLayout>
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <MetricCard label="Type" value={site.type} plane="ops" />
          <MetricCard label="Product" value={product} plane="ops" />
          <MetricCard label="Tenancy" value={tenancy} plane="ops" />
          <MetricCard label="Lifecycle" value={lifecycle} plane="ops" />
          <MetricCard label="Phase" value={phase} plane="ops" />
        </div>

        {siteDeployments.length > 0 && (
          <div>
            <h2 className="mb-3 text-lg font-semibold">System Deployments</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {siteDeployments.map((dep) => {
                const depPhase = (dep.status?.phase as string) ?? "unknown"
                return (
                  <Link
                    key={dep.id}
                    to={`/ops/system-deployments/${dep.slug}`}
                    className="rounded-lg border bg-card p-3 hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon
                          icon={
                            SYSTEM_DEPLOYMENT_TYPE_ICONS[dep.type] ??
                            "icon-[ph--rocket-launch-duotone]"
                          }
                          className="text-base text-muted-foreground"
                        />
                        <span className="font-medium text-base">
                          {dep.name}
                        </span>
                      </div>
                      <StatusBadge status={depPhase} />
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {dep.type}
                    </p>
                  </Link>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </SiteLayout>
  )
}
