import { Link } from "react-router"

import { Icon } from "@rio.js/ui/icon"
import {
  ItemsTableCell as TableCell,
  ItemsTableRow as TableRow,
  ItemsTableHead as TableHead,
} from "@rio.js/app-ui/components/items/items-list/items-table"
import { ItemsProvider } from "@rio.js/app-ui/components/items/items-provider"
import { ItemsView } from "@rio.js/app-ui/components/items/items-view"
import { ItemsPage } from "@rio.js/app-ui/components/items/items-page"
import { ItemsContent } from "@rio.js/app-ui/components/items/items-content"
import { ItemsToolbar } from "@rio.js/app-ui/components/items/items-toolbar"
import { ItemsSearchbar } from "@rio.js/app-ui/components/items/items-searchbar"
import { ItemsSelectFilter } from "@rio.js/app-ui/components/items/items-select-filter"
import { ItemsListView } from "@rio.js/app-ui/components/items/items-list/items-list-view"

import { DashboardPage, StatusBadge } from "@/components/factory"
import { infraFetch } from "@/lib/infra"
import type { Route } from "@/lib/infra/types"

import { ROUTE_TYPE_ICONS } from "../../../../components/type-icons"

const ROUTE_TYPES = [
  { value: "all", label: "All" },
  { value: "ingress", label: "Ingress" },
  { value: "workbench", label: "Workbench" },
  { value: "preview", label: "Preview" },
  { value: "tunnel", label: "Tunnel" },
  { value: "custom-domain", label: "Custom Domain" },
]

const getItems = async (filters: Record<string, any>) => {
  const res = await infraFetch<{ success: boolean; data: Route[] }>(
    "/routes?limit=500"
  )
  let items = res.data
  if (filters.searchTerm) {
    const q = filters.searchTerm.toLowerCase()
    items = items.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.slug.toLowerCase().includes(q) ||
        e.domain.toLowerCase().includes(q)
    )
  }
  if (filters.type && filters.type !== "all") {
    items = items.filter((e) => e.type === filters.type)
  }
  return items
}

const ListHeader = (
  <TableRow>
    <TableHead>Name</TableHead>
    <TableHead>Type</TableHead>
    <TableHead>Domain</TableHead>
    <TableHead>Status</TableHead>
    <TableHead>Protocol</TableHead>
    <TableHead className="w-12" />
  </TableRow>
)

function RouteRow({ item }: { item: Route }) {
  const spec = item.spec as Record<string, any>
  const icon = ROUTE_TYPE_ICONS[item.type] ?? "icon-[ph--cube-duotone]"

  return (
    <TableRow>
      <TableCell className="font-medium">
        <Link
          to={`/infra/routes/${item.slug}`}
          className="hover:text-primary hover:underline"
        >
          {item.name}
        </Link>
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Icon icon={icon} className="text-base" />
          {item.type}
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground font-mono text-xs">
        {item.domain}
      </TableCell>
      <TableCell>
        {spec.status ? (
          <StatusBadge status={spec.status as string} />
        ) : (
          <span className="text-muted-foreground">&mdash;</span>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {(spec.protocol as string) ?? "\u2014"}
      </TableCell>
      <TableCell />
    </TableRow>
  )
}

export default function RoutesPage() {
  return (
    <DashboardPage
      flush
      plane="infra"
      title="Routes"
      description="Ingress rules, custom domains, and traffic routing"
    >
      <ItemsProvider
        getItems={getItems}
        itemType="route"
        initialViewMode="list"
      >
        <ItemsPage>
          <ItemsToolbar>
            <ItemsSearchbar placeholder="Search routes..." />
            <ItemsSelectFilter name="type" options={ROUTE_TYPES} label="Type" />
          </ItemsToolbar>
          <ItemsContent>
            <ItemsView>
              <ItemsListView ListHeader={ListHeader} itemComponent={RouteRow} />
            </ItemsView>
          </ItemsContent>
        </ItemsPage>
      </ItemsProvider>
    </DashboardPage>
  )
}
