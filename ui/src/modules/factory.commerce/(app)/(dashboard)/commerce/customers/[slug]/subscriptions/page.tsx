import { useCustomer, useCustomerSubscriptions } from "@/lib/commerce"
import { Link, useParams } from "react-router"

import { EmptyState, StatusBadge } from "@/components/factory"
import { CustomerLayout } from "../customer-layout"

export default function CustomerSubscriptionsTab() {
  const { slug } = useParams<{ slug: string }>()
  const { data: customer } = useCustomer(slug)
  const { data: subscriptions, isLoading } = useCustomerSubscriptions(
    customer?.id
  )

  return (
    <CustomerLayout>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (subscriptions ?? []).length === 0 ? (
        <EmptyState
          icon="icon-[ph--repeat-duotone]"
          title="No subscriptions"
          description="This customer has no subscriptions yet."
        />
      ) : (
        <div className="space-y-2">
          {(subscriptions ?? []).map((s) => (
            <Link
              key={s.id}
              to={`/commerce/subscriptions/${s.id}`}
              className="flex items-center justify-between rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50"
            >
              <div>
                <span className="font-medium text-base">Subscription</span>
                <span className="ml-2 text-sm text-muted-foreground">
                  {s.planId}
                </span>
              </div>
              <StatusBadge status={s.spec?.status} />
            </Link>
          ))}
        </div>
      )}
    </CustomerLayout>
  )
}
