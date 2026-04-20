import { Link } from "react-router"

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
import type { ComponentDeployment } from "@/lib/ops/types"
import { OpsActionMenu } from "../../../../components/ops-action-menu"

const PHASE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "pending", label: "Pending" },
  { value: "provisioning", label: "Provisioning" },
  { value: "degraded", label: "Degraded" },
  { value: "failed", label: "Failed" },
  { value: "stopped", label: "Stopped" },
]

const getItems = async (filters: Record<string, any>) => {
  const res = await opsFetch<{ success: boolean; data: ComponentDeployment[] }>(
    "/component-deployments?limit=500"
  )
  let items = res.data
  if (filters.searchTerm) {
    const q = filters.searchTerm.toLowerCase()
    items = items.filter(
      (c) =>
        c.componentId.toLowerCase().includes(q) ||
        ((c.spec?.desiredImage as string) ?? "").toLowerCase().includes(q)
    )
  }
  if (filters.phase && filters.phase !== "all") {
    items = items.filter((c) => (c.status?.phase as string) === filters.phase)
  }
  return items
}

const ListHeader = (
  <TableRow>
    <TableHead>Component</TableHead>
    <TableHead>Image</TableHead>
    <TableHead>Replicas</TableHead>
    <TableHead>Mode</TableHead>
    <TableHead>Phase</TableHead>
    <TableHead className="w-12" />
  </TableRow>
)

function ComponentRow({ item }: { item: ComponentDeployment }) {
  const phase = (item.status?.phase as string) ?? "unknown"
  const image = (item.spec?.desiredImage as string) ?? "\u2014"
  const replicas = (item.spec?.replicas as number) ?? 1
  const mode = (item.spec?.mode as string) ?? "deployed"

  return (
    <TableRow>
      <TableCell className="font-medium">
        <Link
          to={`/ops/component-deployments/${item.id}`}
          className="hover:text-primary hover:underline"
        >
          {item.componentId}
        </Link>
      </TableCell>
      <TableCell className="text-muted-foreground font-mono text-sm max-w-[300px] truncate">
        {image}
      </TableCell>
      <TableCell className="text-muted-foreground">{replicas}</TableCell>
      <TableCell className="text-muted-foreground">{mode}</TableCell>
      <TableCell>
        <StatusBadge status={phase} />
      </TableCell>
      <TableCell>
        <OpsActionMenu entityPath="component-deployments" entityId={item.id} />
      </TableCell>
    </TableRow>
  )
}

export default function ComponentDeploymentsPage() {
  return (
    <DashboardPage
      flush
      plane="ops"
      title="Component Deployments"
      description="Individual component instances within system deployments"
    >
      <ItemsProvider
        getItems={getItems}
        itemType="component-deployment"
        initialViewMode="list"
      >
        <ItemsPage>
          <ItemsView>
            <ItemsToolbar>
              <ItemsSearchbar placeholder="Search components..." />
              <ItemsSelectFilter
                name="phase"
                label="Phase"
                options={PHASE_OPTIONS}
              />
            </ItemsToolbar>
            <ItemsContent>
              <ItemsListView
                ListHeader={ListHeader}
                itemComponent={ComponentRow}
              />
            </ItemsContent>
          </ItemsView>
        </ItemsPage>
      </ItemsProvider>
    </DashboardPage>
  )
}
