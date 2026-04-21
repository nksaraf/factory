import { useDeploymentTargets, useOpsSite } from "@/lib/ops"
import { useRealm } from "@/lib/infra"
import { Link, useParams } from "react-router"

import { MetricCard, StatusBadge } from "@/components/factory"
import { SiteLayout } from "./site-layout"

export default function SiteOverviewTab() {
  const { slug } = useParams<{ slug: string }>()
  const { data: site } = useOpsSite(slug)
  const { data: targets } = useDeploymentTargets(
    site ? ({ siteId: site.id } as any) : undefined
  )
  const { data: cluster } = useRealm(site?.clusterId)

  if (!site) return null
  const siteTargets = (targets ?? []).filter((t: any) => t.siteId === site.id)

  return (
    <SiteLayout>
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard
            label="Deployment Targets"
            value={siteTargets.length}
            plane="ops"
          />
          <MetricCard
            label="Manifest Version"
            value={site.currentManifestVersion ?? "\u2014"}
            plane="ops"
          />
          <MetricCard
            label="Cluster"
            value={cluster?.name ?? site.clusterId ?? "\u2014"}
            plane="ops"
          />
        </div>

        <div>
          <h2 className="mb-3 text-lg font-semibold">Deployment Targets</h2>
          {siteTargets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No targets on this site.
            </p>
          ) : (
            <div className="space-y-2">
              {siteTargets.map((t: any) => (
                <Link
                  key={t.id}
                  to={`/ops/targets/${t.slug}`}
                  className="flex items-center justify-between rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50"
                >
                  <div>
                    <span className="font-medium text-base">{t.name}</span>
                    <span className="ml-2 text-sm text-muted-foreground">
                      {t.kind} · {t.realm}
                    </span>
                  </div>
                  <StatusBadge status={t.status} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </SiteLayout>
  )
}
