import { Link, useParams } from "react-router"

import { Icon } from "@rio.js/ui/icon"

import { EmptyState, StatusBadge } from "@/components/factory"
import { useOpsSite, useSystemDeployments } from "@/lib/ops"
import type { SystemDeployment } from "@/lib/ops/types"
import { SYSTEM_DEPLOYMENT_TYPE_ICONS } from "../../../../../../components/type-icons"
import { SiteLayout } from "../site-layout"

export default function SiteSystemsTab() {
  const { slug } = useParams<{ slug: string }>()
  const { data: site } = useOpsSite(slug)
  const { data: allDeployments } = useSystemDeployments()

  if (!site) return null

  const siteDeployments = (allDeployments ?? []).filter(
    (d) => d.siteId === site.id
  )

  const grouped = siteDeployments.reduce<Record<string, SystemDeployment[]>>(
    (acc, dep) => {
      const key = dep.type
      if (!acc[key]) acc[key] = []
      acc[key].push(dep)
      return acc
    },
    {}
  )

  if (siteDeployments.length === 0) {
    return (
      <SiteLayout>
        <EmptyState
          icon="icon-[ph--stack-duotone]"
          title="No system deployments"
          description="This site has no system deployments yet."
        />
      </SiteLayout>
    )
  }

  return (
    <div className="space-y-6">
      {(Object.entries(grouped) as [string, SystemDeployment[]][]).map(
        ([kind, deps]) => (
          <div key={kind}>
            <h2 className="mb-3 text-lg font-semibold capitalize">
              {kind} ({deps.length})
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {deps.map((dep) => {
                const phase = (dep.status?.phase as string) ?? "unknown"
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
                      <StatusBadge status={phase} />
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {dep.type}
                    </p>
                  </Link>
                )
              })}
            </div>
          </div>
        )
      )}
    </div>
  )
}
