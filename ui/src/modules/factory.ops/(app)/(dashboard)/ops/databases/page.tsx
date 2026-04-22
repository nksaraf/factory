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
import { opsFetch } from "@/lib/ops"
import type { OpsDatabase } from "@/lib/ops/types"
import { DATABASE_ENGINE_ICONS } from "../../../../components/type-icons"

const ENGINE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "postgres", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "redis", label: "Redis" },
  { value: "mongodb", label: "MongoDB" },
]

const COLUMNS: ColumnDef[] = [
  { label: "Name", key: "name", sortable: true },
  { label: "Type", key: "spec.engine", sortable: true },
  { label: "Phase", key: "spec.status", sortable: true },
  { label: "Created", key: "createdAt", sortable: true },
  { label: "", className: "w-12" },
]

const getItems = async (filters: Record<string, any>) => {
  const res = await opsFetch<{ success: boolean; data: OpsDatabase[] }>(
    "/databases?limit=500"
  )
  let items = res.data
  if (filters.searchTerm) {
    const q = filters.searchTerm.toLowerCase()
    items = items.filter(
      (d) =>
        d.name.toLowerCase().includes(q) || d.slug.toLowerCase().includes(q)
    )
  }
  if (filters.engine && filters.engine !== "all") {
    items = items.filter((d) => (d.spec?.engine as string) === filters.engine)
  }
  return items
}

function DatabaseRow({ item }: { item: OpsDatabase }) {
  const engine = (item.spec?.engine as string) ?? "unknown"
  const icon = DATABASE_ENGINE_ICONS[engine] ?? "icon-[ph--database-duotone]"
  const status = (item.spec?.status as string) ?? "unknown"

  return (
    <TableRow>
      <TableCell className="font-medium">
        <Link
          to={`/ops/databases/${item.slug}`}
          className="hover:text-primary hover:underline inline-flex items-center gap-1.5"
        >
          <Icon icon={icon} className="text-base text-muted-foreground" />
          {item.name}
        </Link>
      </TableCell>
      <TableCell className="text-muted-foreground">{engine}</TableCell>
      <TableCell>
        <StatusBadge status={status} />
      </TableCell>
      <TableCell className="text-muted-foreground">
        {new Date(item.createdAt).toLocaleDateString()}
      </TableCell>
      <TableCell />
    </TableRow>
  )
}

export default function DatabasesPage() {
  return (
    <DashboardPage
      flush
      plane="ops"
      title="Databases"
      description="Managed database instances — PostgreSQL, MySQL, Redis, MongoDB"
    >
      <ItemsProvider
        getItems={getItems}
        itemType="database"
        initialViewMode="list"
      >
        <ItemsPage>
          <ItemsView>
            <ItemsToolbar>
              <ItemsSearchbar placeholder="Search databases..." />
              <ItemsSelectFilter
                name="engine"
                label="Engine"
                options={ENGINE_OPTIONS}
              />
            </ItemsToolbar>
            <ItemsContent>
              <ItemsListView columns={COLUMNS} itemComponent={DatabaseRow} />
            </ItemsContent>
          </ItemsView>
        </ItemsPage>
      </ItemsProvider>
    </DashboardPage>
  )
}
