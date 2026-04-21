import { Link } from "react-router"

import { Icon } from "@rio.js/ui/icon"
import {
  ItemsTableCell as TableCell,
  ItemsTableRow as TableRow,
  ItemsTableHead as TableHead,
} from "@rio.js/app-ui/components/items/items-list/items-table"

import { DashboardPage } from "@/components/factory"
import { ItemsProvider } from "@rio.js/app-ui/components/items/items-provider"
import { ItemsView } from "@rio.js/app-ui/components/items/items-view"
import { ItemsPage } from "@rio.js/app-ui/components/items/items-page"
import { ItemsContent } from "@rio.js/app-ui/components/items/items-content"
import { ItemsToolbar } from "@rio.js/app-ui/components/items/items-toolbar"
import { ItemsSearchbar } from "@rio.js/app-ui/components/items/items-searchbar"
import { ItemsSelectFilter } from "@rio.js/app-ui/components/items/items-select-filter"
import { ItemsListView } from "@rio.js/app-ui/components/items/items-list/items-list-view"

import { infraFetch } from "@/lib/infra"
import type { DnsDomain } from "@/lib/infra/types"

import { DNS_TYPE_ICONS } from "../../../../components/type-icons"
import { InfraActionMenu } from "../../../../components/infra-action-menu"

const DNS_TYPES = [
  { value: "all", label: "All" },
  { value: "primary", label: "Primary" },
  { value: "alias", label: "Alias" },
  { value: "custom", label: "Custom" },
  { value: "wildcard", label: "Wildcard" },
]

const getItems = async (filters: Record<string, any>) => {
  const res = await infraFetch<{ success: boolean; data: DnsDomain[] }>(
    "/dns-domains?limit=500"
  )
  let items = res.data
  if (filters.searchTerm) {
    const q = filters.searchTerm.toLowerCase()
    items = items.filter(
      (e) =>
        e.name.toLowerCase().includes(q) || e.fqdn.toLowerCase().includes(q)
    )
  }
  if (filters.type && filters.type !== "all") {
    items = items.filter((e) => e.type === filters.type)
  }
  return items
}

const ListHeader = (
  <TableRow>
    <TableHead>FQDN</TableHead>
    <TableHead>Type</TableHead>
    <TableHead>Provider</TableHead>
    <TableHead>Verified</TableHead>
    <TableHead>Records</TableHead>
    <TableHead className="w-12" />
  </TableRow>
)

function DnsRow({ item }: { item: DnsDomain }) {
  const spec = item.spec as Record<string, any>
  const icon = DNS_TYPE_ICONS[item.type] ?? "icon-[ph--cube-duotone]"
  const verified = spec.verified as boolean | undefined
  const records = spec.records as unknown[] | undefined

  return (
    <TableRow>
      <TableCell className="font-medium">
        <Link
          to={`/infra/dns/${item.slug}`}
          className="hover:text-primary hover:underline font-mono"
        >
          {item.fqdn}
        </Link>
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Icon icon={icon} className="text-base" />
          {item.type}
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {(spec.dnsProvider as string) ?? "\u2014"}
      </TableCell>
      <TableCell>
        <Icon
          icon={
            verified
              ? "icon-[ph--check-circle-duotone]"
              : "icon-[ph--x-circle-duotone]"
          }
          className={
            verified
              ? "text-base text-emerald-500"
              : "text-base text-muted-foreground"
          }
        />
      </TableCell>
      <TableCell className="text-muted-foreground">
        {records?.length ?? 0}
      </TableCell>
      <TableCell>
        <InfraActionMenu entityPath="dns-domains" entityId={item.id} />
      </TableCell>
    </TableRow>
  )
}

export default function DnsPage() {
  return (
    <DashboardPage
      flush
      plane="infra"
      title="DNS"
      description="Domain names, DNS records, and verification status"
    >
      <ItemsProvider
        getItems={getItems}
        itemType="dns-domain"
        initialViewMode="list"
      >
        <ItemsPage>
          <ItemsToolbar>
            <ItemsSearchbar placeholder="Search domains..." />
            <ItemsSelectFilter name="type" options={DNS_TYPES} label="Type" />
          </ItemsToolbar>
          <ItemsContent>
            <ItemsView>
              <ItemsListView ListHeader={ListHeader} itemComponent={DnsRow} />
            </ItemsView>
          </ItemsContent>
        </ItemsPage>
      </ItemsProvider>
    </DashboardPage>
  )
}
