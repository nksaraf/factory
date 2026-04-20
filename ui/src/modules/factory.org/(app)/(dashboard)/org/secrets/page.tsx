import { Icon } from "@rio.js/ui/icon"

import { DashboardPage, EmptyState } from "@/components/factory"
import { useSecrets } from "../../../../data/use-org"

export default function SecretsPage() {
  const { data: secrets, isLoading } = useSecrets()
  const all = secrets ?? []

  return (
    <DashboardPage
      plane="agent"
      title="Secrets"
      description="Encrypted secrets and configuration variables"
    >
      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {!isLoading && all.length === 0 && (
        <EmptyState icon="icon-[ph--key-duotone]" title="No secrets" />
      )}

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                Name
              </th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                Scope
              </th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                Environment
              </th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                Updated
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {all.map((s: any) => (
              <tr key={s.id} className="hover:bg-accent/30">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <Icon
                      icon="icon-[ph--key-duotone]"
                      className="text-base text-muted-foreground"
                    />
                    <span className="font-medium font-mono text-base">
                      {s.name ?? s.slug}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {s.scopeType ?? "\u2014"}
                </td>
                <td className="px-4 py-2.5">
                  <span className="px-2 py-0.5 rounded bg-muted text-xs font-mono">
                    {s.environment ?? "all"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {s.updatedAt
                    ? new Date(s.updatedAt).toLocaleDateString()
                    : "\u2014"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardPage>
  )
}
