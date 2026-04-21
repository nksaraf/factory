import { Link } from "react-router"

import { Icon } from "@rio.js/ui/icon"
import {
  ItemsTableCell as TableCell,
  ItemsTableRow as TableRow,
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
import type { ColumnDef } from "@rio.js/app-ui/components/items/items-list/items-list-view"

import { infraFetch } from "@/lib/infra"
import type { Service } from "@/lib/infra/types"

import { SERVICE_TYPE_ICONS } from "../../../../components/type-icons"
import { InfraActionMenu } from "../../../../components/infra-action-menu"

const SERVICE_TYPES = [
  { value: "all", label: "All" },
  { value: "database", label: "Database" },
  { value: "cache", label: "Cache" },
  { value: "object-store", label: "Object Store" },
  { value: "queue", label: "Queue" },
  { value: "search", label: "Search" },
  { value: "llm", label: "LLM" },
  { value: "auth-provider", label: "Auth Provider" },
  { value: "ci-cd", label: "CI/CD" },
  { value: "source-control", label: "Source Control" },
  { value: "monitoring", label: "Monitoring" },
]

const getItems = async (filters: Record<string, any>) => {
  const res = await infraFetch<{ success: boolean; data: Service[] }>(
    "/services?limit=500"
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

const COLUMNS: ColumnDef[] = [
  { label: "Name", key: "name", sortable: true },
  { label: "Type", key: "type", sortable: true },
  { label: "Provider", key: "spec.provider", sortable: true },
  { label: "Endpoint", key: "spec.endpoint", sortable: true },
  { label: "Version", key: "spec.version", sortable: true },
  { label: "", className: "w-12" },
]

function ServiceRow({ item }: { item: Service }) {
  const spec = item.spec as Record<string, any>
  const icon = SERVICE_TYPE_ICONS[item.type] ?? "icon-[ph--cube-duotone]"

  return (
    <TableRow>
      <TableCell className="font-medium">
        <Link
          to={`/infra/services/${item.slug}`}
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
      <TableCell className="text-muted-foreground">
        {(spec.provider as string) ?? "\u2014"}
      </TableCell>
      <TableCell className="text-muted-foreground font-mono text-xs">
        {(spec.endpoint as string) ?? "\u2014"}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {(spec.version as string) ?? "\u2014"}
      </TableCell>
      <TableCell>
        <InfraActionMenu entityPath="services" entityId={item.id} />
      </TableCell>
    </TableRow>
  )
}

export default function ServicesPage() {
  return (
    <DashboardPage
      flush
      plane="infra"
      title="Services"
      description="Databases, caches, queues, and external service integrations"
    >
      <ItemsProvider
        getItems={getItems}
        itemType="service"
        initialViewMode="list"
      >
        <ItemsPage>
          <ItemsToolbar>
            <ItemsSearchbar placeholder="Search services..." />
            <ItemsSelectFilter
              name="type"
              options={SERVICE_TYPES}
              label="Type"
            />
          </ItemsToolbar>
          <ItemsContent>
            <ItemsView>
              <ItemsListView
                columns={COLUMNS}
                itemComponent={ServiceRow}
              />
            </ItemsView>
          </ItemsContent>
        </ItemsPage>
      </ItemsProvider>
    </DashboardPage>
  )
}
