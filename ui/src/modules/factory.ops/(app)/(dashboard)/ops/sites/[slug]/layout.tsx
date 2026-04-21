import { Link, Outlet, useLocation, useParams } from "react-router"

import { cn } from "@rio.js/ui/lib/utils"
import { Icon } from "@rio.js/ui/icon"

import { EmptyState, PlaneHeader, StatusBadge } from "@/components/factory"
import { useOpsSite } from "@/lib/ops"

const TABS = [
  { path: "", label: "Overview", icon: "icon-[ph--squares-four-duotone]" },
  { path: "/systems", label: "Systems", icon: "icon-[ph--stack-duotone]" },
  {
    path: "/components",
    label: "Components",
    icon: "icon-[ph--puzzle-piece-duotone]",
  },
  {
    path: "/deployments",
    label: "Deployments",
    icon: "icon-[ph--rocket-launch-duotone]",
  },
] as const

export default function SiteDetailLayout() {
  const { slug } = useParams<{ slug: string }>()
  const location = useLocation()
  const { data: site, isLoading } = useOpsSite(slug)

  if (isLoading)
    return <p className="p-6 text-sm text-muted-foreground">Loading...</p>
  if (!site)
    return (
      <EmptyState
        title="Site not found"
        description={`No site with slug "${slug}"`}
      />
    )

  const phase = (site.status?.phase as string) ?? "unknown"
  const basePath = `/ops/sites/${slug}`

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 pb-0 space-y-4 shrink-0">
        <PlaneHeader
          plane="ops"
          title={site.name}
          description={`${site.type} site`}
          actions={<StatusBadge status={phase} />}
        />
        <nav className="flex gap-1 border-b">
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
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </div>
    </div>
  )
}
