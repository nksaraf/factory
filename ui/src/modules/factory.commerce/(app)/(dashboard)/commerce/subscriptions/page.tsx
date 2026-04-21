import { useState } from "react"
import { Link } from "react-router"
import { DashboardPage, EmptyState, StatusBadge } from "@/components/factory"
import { useSubscriptions } from "@/lib/commerce"

export default function SubscriptionsPage() {
  const { data: subscriptions = [] } = useSubscriptions()
  const [search, setSearch] = useState("")

  const filtered = subscriptions.filter(
    (s) =>
      s.customerId.toLowerCase().includes(search.toLowerCase()) ||
      s.planId.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <DashboardPage plane="commerce" title="Subscriptions">
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search by customer or plan ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No subscriptions found"
          description="No subscriptions match your search."
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((s) => (
            <Link
              key={s.id}
              to={`/commerce/subscriptions/${s.id}`}
              className="flex items-center justify-between rounded-lg border bg-card p-3 transition-colors hover:bg-accent"
            >
              <div className="flex items-center gap-4">
                <span className="truncate text-sm font-medium" title={s.id}>
                  {s.id.slice(0, 8)}...
                </span>
                <span className="text-sm text-muted-foreground">
                  {s.customerId}
                </span>
                <span className="text-sm text-muted-foreground">
                  {s.planId}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <StatusBadge status={s.spec.status} />
                <span className="text-sm text-muted-foreground">
                  {s.spec.currentPeriodEnd
                    ? new Date(s.spec.currentPeriodEnd).toLocaleDateString()
                    : "—"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </DashboardPage>
  )
}
