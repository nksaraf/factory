import { useParams } from "react-router"
import { PageHeader } from "@/components/factory"
import { MetricCard, StatusBadge } from "@/components/factory"
import { usePlan } from "@/lib/commerce"

export default function PlanDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: plan } = usePlan(slug!)

  if (!plan) return null

  return (
    <div>
      <PageHeader pageGroup="commerce" title={plan.name} />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <MetricCard
          label="Price"
          value={`$${(plan.spec.price / 100).toFixed(2)}`}
        />
        <MetricCard
          label="Billing Interval"
          value={plan.spec.billingInterval}
        />
        <MetricCard label="Trial Days" value={String(plan.spec.trialDays)} />
      </div>

      <div className="mt-6 flex items-center gap-2">
        <span className="text-sm font-medium">Visibility:</span>
        <StatusBadge status={plan.spec.isPublic ? "public" : "private"} />
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-medium">Included Capabilities</h3>
        {plan.spec.includedCapabilities?.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {plan.spec.includedCapabilities.map((cap: string) => (
              <li
                key={cap}
                className="rounded-md border bg-card px-3 py-2 text-sm"
              >
                {cap}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            No capabilities listed
          </p>
        )}
      </div>
    </div>
  )
}
