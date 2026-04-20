import { useParams } from "react-router"

import { EmptyState, StatusBadge } from "@/components/factory"
import { useOpsSites } from "@/lib/ops"
import { SystemLayout } from "../system-layout"

export default function SystemDeploymentsTab() {
  const { slug } = useParams<{ slug: string }>()
  const { data: sites } = useOpsSites()

  const systemSites = (sites ?? []).filter(
    (s: any) => s.systemSlug === slug || s.slug?.includes(slug ?? "")
  )

  return (
    <SystemLayout>
      {systemSites.length === 0 ? (
        <EmptyState
          icon="icon-[ph--rocket-launch-duotone]"
          title="No active deployments"
          description="This system has no sites deployed yet."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {systemSites.map((s: any) => (
            <a
              key={s.id}
              href={`/ops/sites/${s.slug}`}
              className="rounded-lg border bg-card p-4 hover:bg-accent/50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-base">{s.name}</span>
                <StatusBadge
                  status={(s.status?.phase as string) ?? "unknown"}
                />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {(s.spec?.product as string) ?? s.type}
              </p>
            </a>
          ))}
        </div>
      )}
    </SystemLayout>
  )
}
