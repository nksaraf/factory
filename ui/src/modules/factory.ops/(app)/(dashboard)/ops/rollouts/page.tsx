import { Link } from "react-router"

import { TableCell, TableRow, TableHead } from "@rio.js/ui/table"
import { ItemsProvider } from "@rio.js/app-ui/components/items/items-provider"
import { ItemsView } from "@rio.js/app-ui/components/items/items-view"
import { ItemsPage } from "@rio.js/app-ui/components/items/items-page"
import { ItemsContent } from "@rio.js/app-ui/components/items/items-content"
import { ItemsToolbar } from "@rio.js/app-ui/components/items/items-toolbar"
import { ItemsSelectFilter } from "@rio.js/app-ui/components/items/items-select-filter"
import { ItemsListView } from "@rio.js/app-ui/components/items/items-list/items-list-view"

import { DashboardPage, StatusBadge } from "@/components/factory"
import { opsFetch } from "@/lib/ops"
import type { Rollout } from "@/lib/ops/types"

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "rolled_back", label: "Rolled Back" },
]

const getItems = async (filters: Record<string, any>) => {
  const res = await opsFetch<{ success: boolean; data: Rollout[] }>(
    "/rollouts?limit=500"
  )
  let items = res.data
  if (filters.status && filters.status !== "all") {
    items = items.filter((r) => (r.spec?.status as string) === filters.status)
  }
  return items
}

const ListHeader = (
  <TableRow>
    <TableHead>ID</TableHead>
    <TableHead>Strategy</TableHead>
    <TableHead>Progress</TableHead>
    <TableHead>Created</TableHead>
    <TableHead>Status</TableHead>
  </TableRow>
)

function RolloutRow({ item }: { item: Rollout }) {
  const status = (item.spec?.status as string) ?? "unknown"
  const strategy = (item.spec?.strategy as string) ?? "—"
  const progress = (item.spec?.progress as number) ?? 0

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
      <TableCell className="text-muted-foreground">{progress}%</TableCell>
      <TableCell className="text-muted-foreground">
        {new Date(item.createdAt).toLocaleDateString()}
      </TableCell>
      <TableCell>
        <StatusBadge status={status} />
      </TableCell>
    </TableRow>
  )
}

export default function RolloutsPage() {
  return (
    <DashboardPage
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
              <ItemsSelectFilter
                name="status"
                label="Status"
                options={STATUS_OPTIONS}
              />
            </ItemsToolbar>
            <ItemsContent>
              <ItemsListView
                ListHeader={ListHeader}
                itemComponent={RolloutRow}
              />
            </ItemsContent>
          </ItemsView>
        </ItemsPage>
      </ItemsProvider>
    </DashboardPage>
  )
}
