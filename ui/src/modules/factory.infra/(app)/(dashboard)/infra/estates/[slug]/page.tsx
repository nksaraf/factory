import { useEstate, useEstates, useHosts } from "@/lib/infra"
import { Link, useParams } from "react-router"

import { Icon } from "@rio.js/ui/icon"

import {
  EmptyState,
  MetricCard,
  PageHeader,
  StatusBadge,
} from "@/components/factory"

import { InfraActionMenu } from "../../../../../components/infra-action-menu"
import {
  ESTATE_TYPE_ICONS,
  HOST_TYPE_ICONS,
} from "../../../../../components/type-icons"

export default function EstateDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: estate, isLoading } = useEstate(slug)
  const { data: allEstates } = useEstates()
  const { data: allHosts } = useHosts()

  if (isLoading)
    return <p className="p-6 text-sm text-muted-foreground">Loading...</p>
  if (!estate)
    return (
      <EmptyState
        title="Estate not found"
        description={`No estate with slug "${slug}"`}
      />
    )

  const providerKind = (estate.spec.providerKind as string) ?? "\u2014"
  const lifecycle = (estate.spec.lifecycle as string) ?? "unknown"

  const childEstates = (allEstates ?? []).filter(
    (e) => e.parentEstateId === estate.id
  )
  const estateHosts = (allHosts ?? []).filter((h) => h.estateId === estate.id)

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        pageGroup="infra"
        title={estate.name}
        description={`${estate.type} estate`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={lifecycle} />
            <InfraActionMenu entityPath="estates" entityId={estate.id} />
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Type" value={estate.type} plane="infra" />
        <MetricCard label="Provider Kind" value={providerKind} plane="infra" />
        <MetricCard label="Lifecycle" value={lifecycle} plane="infra" />
      </div>

      {childEstates.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Child Estates</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {childEstates.map((child) => (
              <Link
                key={child.id}
                to={`/infra/estates/${child.slug}`}
                className="rounded-lg border bg-card p-3 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon
                      icon={
                        ESTATE_TYPE_ICONS[child.type] ??
                        "icon-[ph--buildings-duotone]"
                      }
                      className="text-base text-muted-foreground"
                    />
                    <span className="font-medium text-base">{child.name}</span>
                  </div>
                  <StatusBadge
                    status={(child.spec.lifecycle as string) ?? "unknown"}
                  />
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {child.type}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {estateHosts.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Hosts</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {estateHosts.map((host) => (
              <Link
                key={host.id}
                to={`/infra/hosts/${host.slug}`}
                className="rounded-lg border bg-card p-3 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon
                      icon={
                        HOST_TYPE_ICONS[host.type] ??
                        "icon-[ph--desktop-tower-duotone]"
                      }
                      className="text-base text-muted-foreground"
                    />
                    <span className="font-medium text-base">{host.name}</span>
                  </div>
                  <StatusBadge
                    status={(host.spec.lifecycle as string) ?? "unknown"}
                  />
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {host.type}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
