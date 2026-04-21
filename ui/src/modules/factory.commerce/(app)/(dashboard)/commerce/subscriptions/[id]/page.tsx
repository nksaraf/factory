import { useParams } from "react-router"

import { MetricCard, PageHeader, StatusBadge } from "@/components/factory"
import { useCommerceAction, useSubscription } from "@/lib/commerce"

export default function SubscriptionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: subscription } = useSubscription(id!)
  const pause = useCommerceAction("subscriptions", id!, "pause")
  const cancel = useCommerceAction("subscriptions", id!, "cancel")
  const resume = useCommerceAction("subscriptions", id!, "resume")

  if (!subscription) return null

  const { spec } = subscription

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        pageGroup="commerce"
        title={`Subscription ${id}`}
        actions={<StatusBadge status={spec.status} />}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Status" value={spec.status} plane="commerce" />
        <MetricCard label="Plan" value={subscription.planId} plane="commerce" />
        <MetricCard
          label="Period End"
          value={
            spec.currentPeriodEnd
              ? new Date(spec.currentPeriodEnd).toLocaleDateString()
              : "—"
          }
          plane="commerce"
        />
      </div>

      <div className="space-y-2">
        <div className="text-base">
          <span className="font-medium">Customer ID:</span>{" "}
          {subscription.customerId}
        </div>
        {spec.status === "cancelled" && spec.cancelReason && (
          <div className="text-base">
            <span className="font-medium">Cancel Reason:</span>{" "}
            {spec.cancelReason}
          </div>
        )}
        {spec.status === "trialing" && spec.trialEndsAt && (
          <div className="text-base">
            <span className="font-medium">Trial End:</span>{" "}
            {new Date(spec.trialEndsAt).toLocaleDateString()}
          </div>
        )}
      </div>

      <div className="flex gap-3">
        {spec.status === "active" && (
          <>
            <button
              onClick={() => pause.mutate()}
              className="rounded-md bg-secondary px-4 py-2 text-base font-medium text-secondary-foreground"
            >
              Pause
            </button>
            <button
              onClick={() => cancel.mutate()}
              className="rounded-md bg-destructive px-4 py-2 text-base font-medium text-destructive-foreground"
            >
              Cancel
            </button>
          </>
        )}
        {spec.status === "paused" && (
          <button
            onClick={() => resume.mutate()}
            className="rounded-md bg-secondary px-4 py-2 text-base font-medium text-secondary-foreground"
          >
            Resume
          </button>
        )}
      </div>
    </div>
  )
}
