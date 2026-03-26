import { Link, useParams } from "react-router"

import { PlaneHeader, StatusBadge, MetricCard, EmptyState } from "@/components/factory"
import { useFleetSite, useDeploymentTargets } from "@/lib/fleet"

export default function SiteDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: site, isLoading } = useFleetSite(slug)
  const { data: targets } = useDeploymentTargets(site ? { siteId: site.id } as any : undefined)

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Loading...</p>
  if (!site) return <EmptyState title="Site not found" description={`No site with slug "${slug}"`} />

  const siteTargets = (targets ?? []).filter((t) => t.siteId === site.id)

  return (
    <div className="space-y-6 p-6">
      <PlaneHeader
        plane="fleet"
        title={site.name}
        description={`${site.product} · ${site.slug}`}
        actions={<StatusBadge status={site.status} />}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Deployment Targets" value={siteTargets.length} plane="fleet" />
        <MetricCard label="Manifest Version" value={site.currentManifestVersion ?? "—"} plane="fleet" />
        <MetricCard label="Cluster" value={site.clusterId} plane="fleet" />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Deployment Targets</h2>
        {siteTargets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No targets on this site.</p>
        ) : (
          <div className="space-y-2">
            {siteTargets.map((t) => (
              <Link
                key={t.id}
                to={`/fleet/targets/${t.slug}`}
                className="flex items-center justify-between rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50"
              >
                <div>
                  <span className="font-medium">{t.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{t.kind} · {t.runtime}</span>
                </div>
                <StatusBadge status={t.status} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
