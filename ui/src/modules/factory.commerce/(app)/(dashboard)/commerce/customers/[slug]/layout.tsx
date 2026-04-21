import { useCustomer } from "@/lib/commerce"
import { Link, Outlet, useLocation, useParams } from "react-router"

import { Icon } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"

import { EmptyState, PageHeader, StatusBadge } from "@/components/factory"

const TABS = [
  { path: "", label: "Overview", icon: "icon-[ph--squares-four-duotone]" },
  {
    path: "/subscriptions",
    label: "Subscriptions",
    icon: "icon-[ph--repeat-duotone]",
  },
  {
    path: "/bundles",
    label: "Bundles",
    icon: "icon-[ph--shield-check-duotone]",
  },
] as const

export default function CustomerDetailLayout() {
  const { slug } = useParams<{ slug: string }>()
  const location = useLocation()
  const { data: customer, isLoading } = useCustomer(slug)

  if (isLoading)
    return <p className="p-6 text-sm text-muted-foreground">Loading...</p>
  if (!customer)
    return (
      <EmptyState
        title="Customer not found"
        description={`No customer with slug "${slug}"`}
      />
    )

  const status = (customer.spec?.status as string) ?? "unknown"
  const basePath = `/commerce/customers/${slug}`

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 pb-0 space-y-4 shrink-0">
        <PageHeader
          pageGroup="commerce"
          title={customer.name}
          description={`${customer.spec?.type ?? "Customer"}`}
          actions={<StatusBadge status={status} />}
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
                    ? "border-emerald-500 text-foreground"
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
