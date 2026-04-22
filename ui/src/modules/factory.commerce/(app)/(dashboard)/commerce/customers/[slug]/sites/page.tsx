import { useCustomer, useCustomerTenants } from "@/lib/commerce"
import { Link, useParams } from "react-router"

import { Icon } from "@rio.js/ui/icon"

import { EmptyState, StatusBadge } from "@/components/factory"
import { CustomerLayout } from "../customer-layout"

export default function CustomerSitesTab() {
  const { slug } = useParams<{ slug: string }>()
  const { data: customer } = useCustomer(slug)
  const { data: tenants, isLoading } = useCustomerTenants(customer?.id)

  return (
    <CustomerLayout>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (tenants ?? []).length === 0 ? (
        <EmptyState
          icon="icon-[ph--globe-hemisphere-west-duotone]"
          title="No sites"
          description="This customer has no site tenancy yet."
        />
      ) : (
        <div className="space-y-3">
          {(tenants ?? []).map((t) => (
            <Link
              key={t.id}
              to={`/ops/sites/${t.slug.replace(/-tenant$/, "")}`}
              className="flex items-center justify-between rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
            >
              <div className="flex items-center gap-3">
                <Icon
                  icon="icon-[ph--globe-hemisphere-west-duotone]"
                  className="text-xl text-teal-400"
                />
                <div>
                  <span className="font-medium text-base">{t.name}</span>
                  <div className="flex gap-3 mt-0.5 text-sm text-muted-foreground">
                    <span>Site: {t.siteId}</span>
                    {t.spec?.isolation && (
                      <span className="capitalize">{t.spec.isolation}</span>
                    )}
                  </div>
                </div>
              </div>
              <StatusBadge
                status={
                  t.spec?.isolation === "dedicated" ? "dedicated" : "shared"
                }
              />
            </Link>
          ))}
        </div>
      )}
    </CustomerLayout>
  )
}
