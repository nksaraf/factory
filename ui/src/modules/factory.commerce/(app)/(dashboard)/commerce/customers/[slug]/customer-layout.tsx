import { useParams } from "react-router"

import { DetailLayout, StatusBadge, type TabDef } from "@/components/factory"
import { useCustomer } from "@/lib/commerce"

const TABS: TabDef[] = [
  { path: "", label: "Overview", icon: "icon-[ph--squares-four-duotone]" },
  {
    path: "/sites",
    label: "Sites",
    icon: "icon-[ph--globe-hemisphere-west-duotone]",
  },
  {
    path: "/subscriptions",
    label: "Subscriptions",
    icon: "icon-[ph--repeat-duotone]",
  },
  {
    path: "/bundles",
    label: "Bundles",
    icon: "icon-[ph--shield-check-duotone]",
  },
]

export function CustomerLayout({ children }: { children: React.ReactNode }) {
  const { slug } = useParams<{ slug: string }>()
  const { data: customer, isLoading } = useCustomer(slug)

  const status = (customer?.spec?.status as string) ?? "unknown"

  return (
    <DetailLayout
      plane="commerce"
      basePath={`/commerce/customers/${slug}`}
      tabs={TABS}
      title={customer?.name ?? ""}
      description={customer?.spec?.type}
      actions={<StatusBadge status={status} />}
      isLoading={isLoading}
      notFound={
        !isLoading && !customer
          ? {
              title: "Customer not found",
              description: `No customer with slug "${slug}"`,
            }
          : undefined
      }
    >
      {children}
    </DetailLayout>
  )
}
