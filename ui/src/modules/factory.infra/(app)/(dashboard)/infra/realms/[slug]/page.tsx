import { useRealm, useRoutes } from "@/lib/infra"
import { useParams } from "react-router"

import { Icon } from "@rio.js/ui/icon"

import {
  EmptyState,
  MetricCard,
  PageHeader,
  StatusBadge,
} from "@/components/factory"

import { InfraActionMenu } from "../../../../../components/infra-action-menu"
import { ROUTE_TYPE_ICONS } from "../../../../../components/type-icons"

export default function RealmDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: realm, isLoading } = useRealm(slug)
  const { data: allRoutes } = useRoutes()

  if (isLoading)
    return <p className="p-6 text-sm text-muted-foreground">Loading...</p>
  if (!realm)
    return (
      <EmptyState
        title="Realm not found"
        description={`No realm with slug "${slug}"`}
      />
    )

  const category = (realm.spec.category as string) ?? "\u2014"
  const status = (realm.spec.status as string) ?? "unknown"
  const version = (realm.spec.version as string) ?? "\u2014"
  const nodeCount = realm.spec.nodeCount as number | undefined

  const realmRoutes = (allRoutes ?? []).filter((r) => r.realmId === realm.id)

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        pageGroup="infra"
        title={realm.name}
        description={`${realm.type} realm`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            <InfraActionMenu entityPath="realms" entityId={realm.id} />
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard label="Type" value={realm.type} plane="infra" />
        <MetricCard label="Category" value={category} plane="infra" />
        <MetricCard label="Version" value={version} plane="infra" />
        <MetricCard label="Status" value={status} plane="infra" />
        <MetricCard
          label="Node Count"
          value={nodeCount ?? "\u2014"}
          plane="infra"
        />
      </div>

      {realmRoutes.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Routes</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {realmRoutes.map((route) => (
              <div
                key={route.id}
                className="rounded-lg border bg-card p-3 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon
                      icon={
                        ROUTE_TYPE_ICONS[route.type] ??
                        "icon-[ph--arrow-square-in-duotone]"
                      }
                      className="text-base text-muted-foreground"
                    />
                    <span className="font-medium text-base">{route.name}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {route.type}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-1 font-mono">
                  {route.domain}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
