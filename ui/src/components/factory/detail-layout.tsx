import { Link, Outlet, useLocation } from "react-router"

import { Icon } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"

import { EmptyState } from "./empty-state"
import { PageHeader, type PageGroup } from "./page-header"

export interface TabDef {
  path: string
  label: string
  icon: string
}

const PLANE_TAB_COLOR: Record<PageGroup, string> = {
  product: "border-purple-500",
  build: "border-amber-500",
  ops: "border-teal-500",
  infra: "border-blue-500",
  agent: "border-green-500",
  commerce: "border-emerald-500",
}

interface DetailLayoutProps {
  plane: PageGroup
  basePath: string
  tabs: readonly TabDef[]
  title: string
  description?: string
  actions?: React.ReactNode
  isLoading?: boolean
  notFound?: { title: string; description: string }
  children?: React.ReactNode
}

export function DetailLayout({
  plane,
  basePath,
  tabs,
  title,
  description,
  actions,
  isLoading,
  notFound,
  children,
}: DetailLayoutProps) {
  const location = useLocation()
  const content = children ?? <Outlet />
  const activeColor = PLANE_TAB_COLOR[plane]

  if (isLoading)
    return <p className="p-6 text-sm text-muted-foreground">Loading...</p>

  if (notFound)
    return (
      <EmptyState title={notFound.title} description={notFound.description} />
    )

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 pb-0 space-y-4 shrink-0">
        <PageHeader
          pageGroup={plane}
          title={title}
          description={description}
          actions={actions}
        />
        <nav className="flex gap-1 border-b">
          {tabs.map((t) => {
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
                    ? `${activeColor} text-foreground`
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
      <div className="flex-1 overflow-y-auto p-6">{content}</div>
    </div>
  )
}
