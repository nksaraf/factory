import { Link } from "react-router"

import { Icon } from "@rio.js/ui/icon"
import { TableCell, TableRow, TableHead } from "@rio.js/ui/table"
import { ItemsProvider } from "@rio.js/app-ui/components/items/items-provider"
import { ItemsView } from "@rio.js/app-ui/components/items/items-view"
import { ItemsPage } from "@rio.js/app-ui/components/items/items-page"
import { ItemsContent } from "@rio.js/app-ui/components/items/items-content"
import { ItemsToolbar } from "@rio.js/app-ui/components/items/items-toolbar"
import { ItemsSearchbar } from "@rio.js/app-ui/components/items/items-searchbar"
import { ItemsSelectFilter } from "@rio.js/app-ui/components/items/items-select-filter"
import { ItemsListView } from "@rio.js/app-ui/components/items/items-list/items-list-view"

import { DashboardPage, StatusBadge } from "@/components/factory"
import { opsFetch } from "@/lib/ops"
import type { OpsDatabase } from "@/lib/ops/types"
import { DATABASE_ENGINE_ICONS } from "../../../../components/type-icons"
import { OpsActionMenu } from "../../../../components/ops-action-menu"

const ENGINE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "postgres", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "redis", label: "Redis" },
  { value: "mongodb", label: "MongoDB" },
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

const ListHeader = (
  <TableRow>
    <TableHead>Name</TableHead>
    <TableHead>Engine</TableHead>
    <TableHead>Version</TableHead>
    <TableHead>Provision</TableHead>
    <TableHead>Status</TableHead>
    <TableHead className="w-12" />
  </TableRow>
)

function DatabaseRow({ item }: { item: OpsDatabase }) {
  const engine = (item.spec?.engine as string) ?? "unknown"
  const icon = DATABASE_ENGINE_ICONS[engine] ?? "icon-[ph--database-duotone]"
  const version = (item.spec?.version as string) ?? "\u2014"
  const provisionMode = (item.spec?.provisionMode as string) ?? "\u2014"
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
      <TableCell className="text-muted-foreground">{version}</TableCell>
      <TableCell className="text-muted-foreground">{provisionMode}</TableCell>
      <TableCell>
        <StatusBadge status={status} />
      </TableCell>
      <TableCell>
        <OpsActionMenu entityPath="databases" entityId={item.id} />
      </TableCell>
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
              <ItemsListView
                ListHeader={ListHeader}
                itemComponent={DatabaseRow}
              />
            </ItemsContent>
          </ItemsView>
        </ItemsPage>
      </ItemsProvider>
    </DashboardPage>
  )
}
