import { Link } from "react-router"

import { Icon } from "@rio.js/ui/icon"
import {
  ItemsTableCell as TableCell,
  ItemsTableRow as TableRow,
} from "@rio.js/app-ui/components/items/items-list/items-table"
import { ItemsProvider } from "@rio.js/app-ui/components/items/items-provider"
import { ItemsView } from "@rio.js/app-ui/components/items/items-view"
import { ItemsPage } from "@rio.js/app-ui/components/items/items-page"
import { ItemsContent } from "@rio.js/app-ui/components/items/items-content"
import { ItemsToolbar } from "@rio.js/app-ui/components/items/items-toolbar"
import { ItemsSearchbar } from "@rio.js/app-ui/components/items/items-searchbar"
import { ItemsSelectFilter } from "@rio.js/app-ui/components/items/items-select-filter"
import { ItemsListView } from "@rio.js/app-ui/components/items/items-list/items-list-view"
import type { ColumnDef } from "@rio.js/app-ui/components/items/items-list/items-list-view"

import { DashboardPage, StatusBadge } from "@/components/factory"
import { infraFetch } from "@/lib/infra"
import type { Estate } from "@/lib/infra/types"
import { ESTATE_TYPE_ICONS } from "../../../../components/type-icons"
import { InfraActionMenu } from "../../../../components/infra-action-menu"

const ESTATE_TYPES = [
  { value: "all", label: "All" },
  { value: "cloud-account", label: "Cloud Account" },
  { value: "region", label: "Region" },
  { value: "datacenter", label: "Datacenter" },
  { value: "vpc", label: "VPC" },
  { value: "subnet", label: "Subnet" },
  { value: "rack", label: "Rack" },
  { value: "dns-zone", label: "DNS Zone" },
  { value: "wan", label: "WAN" },
  { value: "cdn", label: "CDN" },
  { value: "hypervisor", label: "Hypervisor" },
]

const COLUMNS: ColumnDef[] = [
  { label: "Name", key: "name", sortable: true },
  { label: "Type", key: "type", sortable: true },
  { label: "Provider Kind", key: "spec.providerKind", sortable: true },
  { label: "Lifecycle", key: "spec.lifecycle", sortable: true },
  { label: "", className: "w-12" },
]

const getItems = async (filters: Record<string, any>) => {
  const res = await infraFetch<{ success: boolean; data: Estate[] }>(
    "/estates?limit=500"
  )
  let items = res.data
  if (filters.searchTerm) {
    const q = filters.searchTerm.toLowerCase()
    items = items.filter(
      (e) =>
        e.name.toLowerCase().includes(q) || e.slug.toLowerCase().includes(q)
    )
  }
  if (filters.type && filters.type !== "all") {
    items = items.filter((e) => e.type === filters.type)
  }
  return items
}

function EstateRow({ item }: { item: Estate }) {
  const icon = ESTATE_TYPE_ICONS[item.type] ?? "icon-[ph--buildings-duotone]"
  const providerKind = (item.spec.providerKind as string) ?? "—"
  const lifecycle = (item.spec.lifecycle as string) ?? "unknown"

  return (
    <TableRow>
      <TableCell className="font-medium">
        <Link
          to={`/infra/estates/${item.slug}`}
          className="hover:text-primary hover:underline inline-flex items-center gap-1.5"
        >
          <Icon icon={icon} className="text-base text-muted-foreground" />
          {item.name}
        </Link>
      </TableCell>
      <TableCell className="text-muted-foreground">{item.type}</TableCell>
      <TableCell className="text-muted-foreground">{providerKind}</TableCell>
      <TableCell>
        <StatusBadge status={lifecycle} />
      </TableCell>
      <TableCell>
        <InfraActionMenu entityPath="estates" entityId={item.id} />
      </TableCell>
    </TableRow>
  )
}

export default function EstatesPage() {
  return (
    <DashboardPage
      flush
      plane="infra"
      title="Estates"
      description="Cloud accounts, regions, datacenters, VPCs, subnets, and network boundaries"
    >
      <ItemsProvider
        getItems={getItems}
        itemType="estate"
        initialViewMode="list"
      >
        <ItemsPage>
          <ItemsView>
            <ItemsToolbar>
              <ItemsSearchbar placeholder="Search estates..." />
              <ItemsSelectFilter
                name="type"
                label="Type"
                options={ESTATE_TYPES}
              />
            </ItemsToolbar>
            <ItemsContent>
              <ItemsListView
                columns={COLUMNS}
                itemComponent={EstateRow}
              />
            </ItemsContent>
          </ItemsView>
        </ItemsPage>
      </ItemsProvider>
    </DashboardPage>
  )
}
