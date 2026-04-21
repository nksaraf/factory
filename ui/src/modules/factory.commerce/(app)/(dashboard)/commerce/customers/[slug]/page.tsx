import {
  useCustomer,
  useCustomerSubscriptions,
  useCustomerBundles,
} from "@/lib/commerce"
import { Link, useParams } from "react-router"

import { MetricCard, StatusBadge } from "@/components/factory"

export default function CustomerOverviewTab() {
  const { slug } = useParams<{ slug: string }>()
  const { data: customer } = useCustomer(slug)
  const { data: subscriptions } = useCustomerSubscriptions(customer?.id)
  const { data: bundles } = useCustomerBundles(customer?.id)

  if (!customer) return null

  const activeSubscriptions = (subscriptions ?? []).filter(
    (s) => s.spec?.status === "active"
  )

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          label="Active Subscriptions"
          value={activeSubscriptions.length}
          plane="commerce"
        />
        <MetricCard
          label="Entitlement Bundles"
          value={(bundles ?? []).length}
          plane="commerce"
        />
        <MetricCard
          label="Customer Status"
          value={customer.spec?.status ?? "unknown"}
          plane="commerce"
        />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Recent Subscriptions</h2>
        {(subscriptions ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No subscriptions yet.</p>
        ) : (
          <div className="space-y-2">
            {(subscriptions ?? []).slice(0, 5).map((s) => (
              <Link
                key={s.id}
                to={`/commerce/subscriptions/${s.id}`}
                className="flex items-center justify-between rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50"
              >
                <div>
                  <span className="font-medium text-base">
                    {s.spec?.planId ?? "Subscription"}
                  </span>
                  <span className="ml-2 text-sm text-muted-foreground">
                    {s.spec?.periodStart} - {s.spec?.periodEnd}
                  </span>
                </div>
                <StatusBadge status={s.spec?.status} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
