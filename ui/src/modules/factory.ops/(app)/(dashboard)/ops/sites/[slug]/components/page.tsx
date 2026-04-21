import { Link, useParams } from "react-router"

import { EmptyState, StatusBadge } from "@/components/factory"
import {
  useOpsSite,
  useSystemDeployments,
  useComponentDeployments,
} from "@/lib/ops"
import { SiteLayout } from "../site-layout"

export default function SiteComponentsTab() {
  const { slug } = useParams<{ slug: string }>()
  const { data: site } = useOpsSite(slug)
  const { data: allDeployments } = useSystemDeployments()
  const { data: allComponents } = useComponentDeployments()

  if (!site) return null

  const siteDeploymentIds = new Set(
    (allDeployments ?? []).filter((d) => d.siteId === site.id).map((d) => d.id)
  )
  const siteComponents = (allComponents ?? []).filter((c) =>
    siteDeploymentIds.has(c.systemDeploymentId)
  )

  if (siteComponents.length === 0) {
    return (
      <SiteLayout>
        <EmptyState
          icon="icon-[ph--puzzle-piece-duotone]"
          title="No components"
          description="No component deployments found for this site."
        />
      </SiteLayout>
    )
  }

  return (
    <SiteLayout>
    <div className="space-y-2">
      {siteComponents.map((comp) => {
        const phase = (comp.status?.phase as string) ?? "unknown"
        const image = (comp.spec?.desiredImage as string) ?? "—"
        const replicas = (comp.spec?.replicas as number) ?? 1
        return (
          <Link
            key={comp.id}
            to={`/ops/component-deployments/${comp.id}`}
            className="flex items-center justify-between rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50"
          >
            <div>
              <span className="font-medium text-base">{comp.componentId}</span>
              <span className="ml-2 text-sm text-muted-foreground">
                {replicas} replica{replicas !== 1 ? "s" : ""} · {image}
              </span>
            </div>
            <StatusBadge status={phase} />
          </Link>
        )
      })}
    </div>
    </SiteLayout>
  )
}
