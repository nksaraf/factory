import { Link, useLocation, useParams } from "react-router"

import { Icon } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"

import { EmptyState, PageHeader, StatusBadge } from "@/components/factory"

import { useSystem } from "../../../../../data/use-build"

const TABS = [
  { path: "", label: "Overview", icon: "icon-[ph--squares-four-duotone]" },
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
  { path: "/graph", label: "Architecture", icon: "icon-[ph--graph-duotone]" },
] as const

export function SystemLayout({ children }: { children: React.ReactNode }) {
  const { slug } = useParams<{ slug: string }>()
  const location = useLocation()
  const { data: system, isLoading } = useSystem(slug)

  if (isLoading)
    return <p className="p-6 text-sm text-muted-foreground">Loading...</p>
  if (!system)
    return (
      <EmptyState
        title="System not found"
        description={`No system with slug "${slug}"`}
      />
    )

  const status =
    typeof system.status === "object" && system.status
      ? (system.status as Record<string, unknown>).phase
      : (system.lifecycle ?? system.status)
  const basePath = `/build/systems/${slug}`

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 pb-0 space-y-4 shrink-0">
        <PageHeader
          pageGroup="build"
          title={system.name ?? slug}
          description={system.description ?? `${system.slug}`}
          actions={
            <StatusBadge
              status={typeof status === "string" ? status : "unknown"}
            />
          }
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
                  "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                  isActive
                    ? "border-amber-500 text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                )}
              >
                <Icon icon={t.icon} className="text-sm" />
                {t.label}
              </Link>
            )
          })}
        </nav>
      </div>
      <div className="flex-1 overflow-y-auto p-6 min-h-0">{children}</div>
    </div>
  )
}
