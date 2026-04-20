import { useHost } from "@/lib/infra"
import { Link, useLocation, useParams } from "react-router"

import { Icon } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"

import { EmptyState, PageHeader, StatusBadge } from "@/components/factory"

import { InfraActionMenu } from "../../../../../components/infra-action-menu"

const TABS = [
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
] as const

export function HostLayout({ children }: { children: React.ReactNode }) {
  const { slug } = useParams<{ slug: string }>()
  const location = useLocation()
  const { data: host, isLoading } = useHost(slug)

  if (isLoading)
    return <p className="p-6 text-sm text-muted-foreground">Loading...</p>
  if (!host)
    return (
      <EmptyState
        title="Host not found"
        description={`No host with slug "${slug}"`}
      />
    )

  const lifecycle = (host.spec.lifecycle as string) ?? "unknown"
  const basePath = `/infra/hosts/${slug}`

  return (
    <div className="flex flex-col h-full p-6 gap-5">
      <PageHeader
        pageGroup="infra"
        title={host.name}
        description={`${host.type} host`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={lifecycle} />
            <InfraActionMenu entityPath="hosts" entityId={host.id} />
          </div>
        }
        className="shrink-0"
      />
      <nav className="flex gap-1 border-b shrink-0">
        {TABS.map((t) => {
          const href = `${basePath}${t.path}`
          const isActive =
            t.path === ""
              ? location.pathname === basePath ||
                location.pathname === `${basePath}/`
              : location.pathname.startsWith(href)
          return (
            <Link
              key={t.path}
              to={href}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-base font-medium border-b-2 -mb-px transition-colors",
                isActive
                  ? "border-teal-500 text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              )}
            >
              <Icon icon={t.icon} className="text-base" />
              {t.label}
            </Link>
          )
        })}
      </nav>
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  )
}
