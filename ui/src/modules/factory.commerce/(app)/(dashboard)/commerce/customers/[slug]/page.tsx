import {
  useCustomer,
  useCustomerSubscriptions,
  useCustomerBundles,
  useCustomerTenants,
} from "@/lib/commerce"
import { Link, useParams } from "react-router"

import { Icon } from "@rio.js/ui/icon"

import { MetricCard, StatusBadge } from "@/components/factory"
import { CustomerLayout } from "./customer-layout"

export default function CustomerOverviewTab() {
  const { slug } = useParams<{ slug: string }>()
  const { data: customer } = useCustomer(slug)
  const { data: subscriptions } = useCustomerSubscriptions(slug)
  const { data: bundles } = useCustomerBundles(slug)
  const { data: tenants } = useCustomerTenants(slug)

  if (!customer) return null

  const activeSubscriptions = (subscriptions ?? []).filter(
    (s) => s.spec?.status === "active" || s.spec?.status === "trialing"
  )

  return (
    <CustomerLayout>
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-4">
          <MetricCard
            label="Sites"
            value={(tenants ?? []).length}
            plane="commerce"
          />
          <MetricCard
            label="Subscriptions"
            value={activeSubscriptions.length}
            plane="commerce"
          />
          <MetricCard
            label="Entitlement Bundles"
            value={(bundles ?? []).length}
            plane="commerce"
          />
          <MetricCard
            label="Status"
            value={customer.spec?.status ?? "unknown"}
            plane="commerce"
          />
        </div>

        {(tenants ?? []).length > 0 && (
          <div>
            <h2 className="mb-3 text-lg font-semibold">Sites</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {(tenants ?? []).map((t) => (
                <Link
                  key={t.id}
                  to={`/commerce/customers/${slug}/sites`}
                  className="flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50"
                >
                  <Icon
                    icon="icon-[ph--globe-hemisphere-west-duotone]"
                    className="text-xl text-teal-400"
                  />
                  <div>
                    <span className="font-medium text-base">{t.name}</span>
                    <span className="ml-2 text-sm text-muted-foreground capitalize">
                      {t.spec?.isolation ?? "shared"}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div>
          <h2 className="mb-3 text-lg font-semibold">Subscriptions</h2>
          {(subscriptions ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No subscriptions yet.
            </p>
          ) : (
            <div className="space-y-2">
              {(subscriptions ?? []).slice(0, 5).map((s) => (
                <Link
                  key={s.id}
                  to={`/commerce/subscriptions/${s.id}`}
                  className="flex items-center justify-between rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50"
                >
                  <div>
                    <span className="font-medium text-base">Subscription</span>
                    <span className="ml-2 text-xs text-muted-foreground font-mono">
                      {s.id.slice(0, 12)}…
                    </span>
                  </div>
                  <StatusBadge status={s.spec?.status} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </CustomerLayout>
  )
}
