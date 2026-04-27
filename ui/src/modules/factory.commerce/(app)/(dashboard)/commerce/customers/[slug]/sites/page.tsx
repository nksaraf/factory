import { useCustomerTenants } from "@/lib/commerce"
import { useParams } from "react-router"

import { Icon } from "@rio.js/ui/icon"

import { EmptyState, StatusBadge } from "@/components/factory"
import { CustomerLayout } from "../customer-layout"

export default function CustomerSitesTab() {
  const { slug } = useParams<{ slug: string }>()
  const { data: tenants, isLoading } = useCustomerTenants(slug)

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
            <div
              key={t.id}
              className="flex items-center justify-between rounded-lg border bg-card p-4"
            >
              <div className="flex items-center gap-3">
                <Icon
                  icon="icon-[ph--globe-hemisphere-west-duotone]"
                  className="text-xl text-teal-400"
                />
                <div>
                  <span className="font-medium text-base">{t.name}</span>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {t.slug}
                    {t.spec?.isolation && (
                      <span className="ml-2 capitalize">
                        · {t.spec.isolation}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <StatusBadge
                status={
                  t.spec?.isolation === "dedicated" ? "dedicated" : "shared"
                }
              />
            </div>
          ))}
        </div>
      )}
    </CustomerLayout>
  )
}
