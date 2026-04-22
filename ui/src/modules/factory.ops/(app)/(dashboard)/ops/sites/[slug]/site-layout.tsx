import { useParams } from "react-router"

import { DetailLayout, StatusBadge, type TabDef } from "@/components/factory"
import { useOpsSite } from "@/lib/ops"

const TABS: TabDef[] = [
  { path: "", label: "Overview", icon: "icon-[ph--squares-four-duotone]" },
  { path: "/systems", label: "Systems", icon: "icon-[ph--stack-duotone]" },
  {
    path: "/components",
    label: "Components",
    icon: "icon-[ph--puzzle-piece-duotone]",
  },
  {
    path: "/deployments",
    label: "Deployments",
    icon: "icon-[ph--rocket-launch-duotone]",
  },
]

export function SiteLayout({ children }: { children: React.ReactNode }) {
  const { slug } = useParams<{ slug: string }>()
  const { data: site, isLoading } = useOpsSite(slug)

  const phase = (site?.status?.phase as string) ?? "unknown"

  return (
    <DetailLayout
      plane="ops"
      basePath={`/ops/sites/${slug}`}
      tabs={TABS}
      title={site?.name ?? ""}
      description={site ? `${site.type} site` : undefined}
      actions={<StatusBadge status={phase} />}
      isLoading={isLoading}
      notFound={
        !isLoading && !site
          ? {
              title: "Site not found",
              description: `No site with slug "${slug}"`,
            }
          : undefined
      }
    >
      {children}
    </DetailLayout>
  )
}
