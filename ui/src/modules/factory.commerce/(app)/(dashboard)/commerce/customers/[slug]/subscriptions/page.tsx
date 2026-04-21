import { useCustomer, useCustomerSubscriptions } from "@/lib/commerce"
import { Link, useParams } from "react-router"

import { EmptyState, StatusBadge } from "@/components/factory"

export default function CustomerSubscriptionsTab() {
  const { slug } = useParams<{ slug: string }>()
  const { data: customer } = useCustomer(slug)
  const { data: subscriptions, isLoading } = useCustomerSubscriptions(
    customer?.id
  )

  if (isLoading)
    return <p className="text-sm text-muted-foreground">Loading...</p>

  if ((subscriptions ?? []).length === 0) {
    return (
      <EmptyState
        icon="icon-[ph--repeat-duotone]"
        title="No subscriptions"
        description="This customer has no subscriptions yet."
      />
    )
  }

  return (
    <div className="space-y-2">
      {(subscriptions ?? []).map((s) => (
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
  )
}
