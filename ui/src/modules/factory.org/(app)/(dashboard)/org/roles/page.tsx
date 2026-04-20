import { Icon } from "@rio.js/ui/icon"

import { DashboardPage, EmptyState, StatusBadge } from "@/components/factory"
import { useRolePresets } from "../../../../data/use-org"

export default function RolesPage() {
  const { data: roles, isLoading } = useRolePresets()
  const all = roles ?? []

  return (
    <DashboardPage
      plane="agent"
      title="Roles"
      description="Agent role presets and permission configurations"
    >
      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {!isLoading && all.length === 0 && (
        <EmptyState
          icon="icon-[ph--shield-check-duotone]"
          title="No roles defined"
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 content-start">
        {all.map((r: any) => {
          const spec = r.spec ?? {}
          return (
            <div key={r.id} className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-3">
                <Icon
                  icon="icon-[ph--shield-check-duotone]"
                  className="text-2xl text-muted-foreground"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-base">
                    {r.name ?? r.slug}
                  </div>
                  <div className="text-sm text-muted-foreground font-mono">
                    {r.slug}
                  </div>
                </div>
                <StatusBadge status={spec.autonomy ?? "unknown"} />
              </div>
              {spec.description && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {spec.description}
                </p>
              )}
              <div className="mt-3 flex gap-2 flex-wrap">
                {spec.autonomy && (
                  <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                    autonomy: {spec.autonomy}
                  </span>
                )}
                {spec.trust && (
                  <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                    trust: {spec.trust}
                  </span>
                )}
                {spec.scope && (
                  <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                    scope: {spec.scope}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </DashboardPage>
  )
}
