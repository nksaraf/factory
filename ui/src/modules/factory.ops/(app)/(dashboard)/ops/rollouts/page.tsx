import { Link } from "react-router"

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
import { OpsActionMenu } from "../../../../components/ops-action-menu"
import type { Rollout } from "@/lib/ops/types"

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "rolled_back", label: "Rolled Back" },
]

const COLUMNS: ColumnDef[] = [
  { label: "Name", key: "id", sortable: true },
  { label: "Strategy", key: "spec.strategy" },
  { label: "Status", key: "spec.status", sortable: true },
  { label: "Created", key: "createdAt", sortable: true },
  { label: "", className: "w-12" },
]

const getItems = async (filters: Record<string, any>) => {
  const res = await opsFetch<{ success: boolean; data: Rollout[] }>(
    "/rollouts?limit=500"
  )
  let items = res.data
  if (filters.searchTerm) {
    const q = filters.searchTerm.toLowerCase()
    items = items.filter((r) => r.id.toLowerCase().includes(q))
  }
  if (filters.status && filters.status !== "all") {
    items = items.filter((r) => (r.spec?.status as string) === filters.status)
  }
  return items
}

function RolloutRow({ item }: { item: Rollout }) {
  const status = (item.spec?.status as string) ?? "unknown"
  const strategy = (item.spec?.strategy as string) ?? "—"

  return (
    <TableRow>
      <TableCell className="font-medium">
        <Link
          to={`/ops/rollouts/${item.id}`}
          className="hover:text-primary hover:underline font-mono text-sm"
        >
          {item.id.slice(0, 12)}...
        </Link>
      </TableCell>
      <TableCell className="text-muted-foreground">{strategy}</TableCell>
      <TableCell>
        <StatusBadge status={status} />
      </TableCell>
      <TableCell className="text-muted-foreground">
        {new Date(item.createdAt).toLocaleDateString()}
      </TableCell>
      <TableCell><OpsActionMenu entityPath="rollouts" entityId={item.id} /></TableCell>
    </TableRow>
  )
}

export default function RolloutsPage() {
  return (
    <DashboardPage
      flush
      plane="ops"
      title="Rollouts"
      description="Progressive deployment rollouts across system deployments"
    >
      <ItemsProvider
        getItems={getItems}
        itemType="rollout"
        initialViewMode="list"
      >
        <ItemsPage>
          <ItemsView>
            <ItemsToolbar>
              <ItemsSearchbar placeholder="Search rollouts..." />
              <ItemsSelectFilter
                name="status"
                label="Status"
                options={STATUS_OPTIONS}
              />
            </ItemsToolbar>
            <ItemsContent>
              <ItemsListView columns={COLUMNS} itemComponent={RolloutRow} />
            </ItemsContent>
          </ItemsView>
        </ItemsPage>
      </ItemsProvider>
    </DashboardPage>
  )
}
