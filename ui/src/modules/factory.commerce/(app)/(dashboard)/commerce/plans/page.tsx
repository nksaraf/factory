import { useState } from "react"
import { Link } from "react-router"
import { DashboardPage, EmptyState } from "@/components/factory"
import { usePlans } from "@/lib/commerce"

export default function PlansPage() {
  const { data: plans = [] } = usePlans()
  const [search, setSearch] = useState("")

  const filtered = plans.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.slug.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <DashboardPage plane="commerce" title="Plans">
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search plans..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No plans found"
          description="No pricing plans match your search."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <Link
              key={p.slug}
              to={`/commerce/plans/${p.slug}`}
              className="rounded-lg border bg-card p-4 transition-colors hover:bg-accent"
            >
              <div className="flex items-center justify-between">
                <span className="text-base font-medium">{p.name}</span>
                <span className="rounded bg-muted px-2 py-0.5 text-xs">
                  {p.spec.type}
                </span>
              </div>
              <div className="mt-2 text-2xl font-semibold">
                ${(p.spec.price / 100).toFixed(2)}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {p.spec.billingInterval}
              </div>
              {p.spec.trialDays > 0 && (
                <div className="mt-1 text-sm text-muted-foreground">
                  {p.spec.trialDays}-day trial
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </DashboardPage>
  )
}
