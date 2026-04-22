import { useHost } from "@/lib/infra"
import { useParams } from "react-router"

import { DetailLayout, StatusBadge, type TabDef } from "@/components/factory"

import { InfraActionMenu } from "../../../../../components/infra-action-menu"

const TABS: TabDef[] = [
  { path: "", label: "Overview", icon: "icon-[ph--squares-four-duotone]" },
  {
    path: "/terminal",
    label: "Terminal",
    icon: "icon-[ph--terminal-window-duotone]",
  },
  { path: "/files", label: "Files", icon: "icon-[ph--folder-open-duotone]" },
  {
    path: "/monitoring",
    label: "Monitoring",
    icon: "icon-[ph--chart-line-duotone]",
  },
  {
    path: "/activity",
    label: "Activity",
    icon: "icon-[ph--clock-counter-clockwise-duotone]",
  },
]

export function HostLayout({ children }: { children: React.ReactNode }) {
  const { slug } = useParams<{ slug: string }>()
  const { data: host, isLoading } = useHost(slug)

  const lifecycle = (host?.spec.lifecycle as string) ?? "unknown"

  return (
    <DetailLayout
      plane="infra"
      basePath={`/infra/hosts/${slug}`}
      tabs={TABS}
      title={host?.name ?? ""}
      description={host ? `${host.type} host` : undefined}
      actions={
        host ? (
          <div className="flex items-center gap-2">
            <StatusBadge status={lifecycle} />
            <InfraActionMenu entityPath="hosts" entityId={host.id} />
          </div>
        ) : undefined
      }
      isLoading={isLoading}
      notFound={
        !isLoading && !host
          ? {
              title: "Host not found",
              description: `No host with slug "${slug}"`,
            }
          : undefined
      }
    >
      {children}
    </DetailLayout>
  )
}
