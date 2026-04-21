import { Link, useLocation, useParams } from "react-router"

import { cn } from "@rio.js/ui/lib/utils"
import { Icon } from "@rio.js/ui/icon"

import { EmptyState, PageHeader, StatusBadge } from "@/components/factory"
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

export function SiteLayout({ children }: { children: React.ReactNode }) {
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
    <div className="flex flex-col h-full p-6 gap-5">
      <PageHeader
        pageGroup="ops"
        title={site.name}
        description={`${site.type} site`}
        actions={<StatusBadge status={phase} />}
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
