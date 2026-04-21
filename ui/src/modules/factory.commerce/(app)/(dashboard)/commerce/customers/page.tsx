import { useCustomers } from "@/lib/commerce"
import { useState } from "react"
import { Link } from "react-router"

import { DashboardPage, EmptyState, StatusBadge } from "@/components/factory"

export default function CustomersPage() {
  const { data: customers, isLoading } = useCustomers()
  const [search, setSearch] = useState("")

  const filtered = (customers ?? []).filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.spec?.company ?? "").toLowerCase().includes(search.toLowerCase())
  )

  const toolbar = (
    <input
      placeholder="Search customers..."
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      className="max-w-sm text-base px-3 py-2 rounded-md border bg-card text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
    />
  )

  return (
    <DashboardPage
      plane="commerce"
      title="Customers"
      description="All customers"
      toolbar={toolbar}
    >
      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading customers...</p>
      )}

      {!isLoading && filtered.length === 0 && (
        <EmptyState
          icon="icon-[ph--users-duotone]"
          title="No customers found"
          description="No customers match your search."
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 content-start">
        {filtered.map((c) => (
          <Link
            key={c.id}
            to={`/commerce/customers/${c.slug}`}
            className="block rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-medium text-base">{c.name}</h3>
              <StatusBadge status={c.spec?.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {c.spec?.company}
            </p>
            <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
              {c.spec?.type && (
                <span className="rounded-full bg-muted px-2 py-0.5">
                  {c.spec.type}
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </DashboardPage>
  )
}
