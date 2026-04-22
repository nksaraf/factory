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
import type { Intervention } from "@/lib/ops/types"
import { INTERVENTION_TYPE_ICONS } from "../../../../components/type-icons"

const TYPE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "restart", label: "Restart" },
  { value: "scale", label: "Scale" },
  { value: "rollback", label: "Rollback" },
  { value: "manual", label: "Manual" },
]

const COLUMNS: ColumnDef[] = [
  { label: "Name", key: "type", sortable: true },
  { label: "Type", key: "type", sortable: true },
  { label: "Status", key: "spec.status", sortable: true },
  { label: "Created", key: "createdAt", sortable: true },
  { label: "", className: "w-12" },
]

const getItems = async (filters: Record<string, any>) => {
  const res = await opsFetch<{ success: boolean; data: Intervention[] }>(
    "/interventions?limit=500"
  )
  let items = res.data
  if (filters.searchTerm) {
    const q = filters.searchTerm.toLowerCase()
    items = items.filter(
      (i) =>
        i.type.toLowerCase().includes(q) || i.id.toLowerCase().includes(q)
    )
  }
  if (filters.type && filters.type !== "all") {
    items = items.filter((i) => i.type === filters.type)
  }
  return items
}

function InterventionRow({ item }: { item: Intervention }) {
  const icon = INTERVENTION_TYPE_ICONS[item.type] ?? "icon-[ph--hand-duotone]"
  const status = (item.spec?.status as string) ?? "unknown"

  return (
    <TableRow>
      <TableCell className="font-medium">
        <Link
          to={`/ops/interventions/${item.id}`}
          className="hover:text-primary hover:underline inline-flex items-center gap-1.5"
        >
          <Icon icon={icon} className="text-base text-muted-foreground" />
          {item.type}
        </Link>
      </TableCell>
      <TableCell className="text-muted-foreground">{item.type}</TableCell>
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

export default function InterventionsPage() {
  return (
    <DashboardPage
      flush
      plane="ops"
      title="Interventions"
      description="Manual operational interventions -- restarts, scaling, rollbacks"
    >
      <ItemsProvider
        getItems={getItems}
        itemType="intervention"
        initialViewMode="list"
      >
        <ItemsPage>
          <ItemsView>
            <ItemsToolbar>
              <ItemsSearchbar placeholder="Search interventions..." />
              <ItemsSelectFilter
                name="type"
                label="Type"
                options={TYPE_OPTIONS}
              />
            </ItemsToolbar>
            <ItemsContent>
              <ItemsListView
                columns={COLUMNS}
                itemComponent={InterventionRow}
              />
            </ItemsContent>
          </ItemsView>
        </ItemsPage>
      </ItemsProvider>
    </DashboardPage>
  )
}
