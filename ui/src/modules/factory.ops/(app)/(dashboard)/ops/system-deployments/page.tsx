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
import { OpsActionMenu } from "../../../../components/ops-action-menu"
import type { SystemDeployment } from "@/lib/ops/types"
import { SYSTEM_DEPLOYMENT_TYPE_ICONS } from "../../../../components/type-icons"

const DEPLOYMENT_TYPES = [
  { value: "all", label: "All" },
  { value: "production", label: "Production" },
  { value: "staging", label: "Staging" },
  { value: "dev", label: "Dev" },
  { value: "preview", label: "Preview" },
]

const COLUMNS: ColumnDef[] = [
  { label: "Name", key: "name", sortable: true },
  { label: "Type", key: "type", sortable: true },
  { label: "Site", key: "siteId" },
  { label: "Phase", key: "status.phase", sortable: true },
  { label: "", className: "w-12" },
]

const getItems = async (filters: Record<string, any>) => {
  const res = await opsFetch<{ success: boolean; data: SystemDeployment[] }>(
    "/system-deployments?limit=500"
  )
  let items = res.data
  if (filters.searchTerm) {
    const q = filters.searchTerm.toLowerCase()
    items = items.filter(
      (d) =>
        d.name.toLowerCase().includes(q) || d.slug.toLowerCase().includes(q)
    )
  }
  if (filters.type && filters.type !== "all") {
    items = items.filter((d) => d.type === filters.type)
  }
  return items
}

function DeploymentRow({ item }: { item: SystemDeployment }) {
  const icon =
    SYSTEM_DEPLOYMENT_TYPE_ICONS[item.type] ??
    "icon-[ph--rocket-launch-duotone]"
  const phase = (item.status?.phase as string) ?? "unknown"

  return (
    <TableRow>
      <TableCell className="font-medium">
        <Link
          to={`/ops/system-deployments/${item.slug}`}
          className="hover:text-primary hover:underline inline-flex items-center gap-1.5"
        >
          <Icon icon={icon} className="text-base text-muted-foreground" />
          {item.name}
        </Link>
      </TableCell>
      <TableCell className="text-muted-foreground">{item.type}</TableCell>
      <TableCell className="text-muted-foreground">{item.siteId}</TableCell>
      <TableCell>
        <StatusBadge status={phase} />
      </TableCell>
      <TableCell><OpsActionMenu entityPath="system-deployments" entityId={item.id} /></TableCell>
    </TableRow>
  )
}

export default function SystemDeploymentsPage() {
  return (
    <DashboardPage
      flush
      plane="ops"
      title="System Deployments"
      description="Deployments of systems to sites, tenants, and realms"
    >
      <ItemsProvider
        getItems={getItems}
        itemType="system-deployment"
        initialViewMode="list"
      >
        <ItemsPage>
          <ItemsView>
            <ItemsToolbar>
              <ItemsSearchbar placeholder="Search deployments..." />
              <ItemsSelectFilter
                name="type"
                label="Type"
                options={DEPLOYMENT_TYPES}
              />
            </ItemsToolbar>
            <ItemsContent>
              <ItemsListView
                columns={COLUMNS}
                itemComponent={DeploymentRow}
              />
            </ItemsContent>
          </ItemsView>
        </ItemsPage>
      </ItemsProvider>
    </DashboardPage>
  )
}
