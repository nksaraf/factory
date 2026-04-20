import { useParams } from "react-router"

import { MetricCard } from "@/components/factory"
import { usePrincipal, usePrincipalLinks } from "../../../../../data/use-org"
import { PrincipalLayout } from "./principal-layout"

export default function PrincipalOverviewTab() {
  const { slug } = useParams<{ slug: string }>()
  const { data: principal } = usePrincipal(slug)
  const { data: links } = usePrincipalLinks(slug)

  if (!principal) return null
  const providers = [
    ...new Set((links ?? []).map((l: any) => l.type ?? l.provider)),
  ]

  return (
    <PrincipalLayout>
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard
            label="Identity Links"
            value={(links ?? []).length}
            plane="agent"
          />
          <MetricCard
            label="Providers"
            value={providers.length}
            plane="agent"
          />
          <MetricCard
            label="Type"
            value={principal.type ?? "\u2014"}
            plane="agent"
          />
        </div>
        {principal.createdAt && (
          <p className="text-sm text-muted-foreground">
            Joined {new Date(principal.createdAt).toLocaleDateString()}
          </p>
        )}
      </div>
    </PrincipalLayout>
  )
}
