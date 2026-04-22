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
import type { Workbench } from "@/lib/ops/types"
import { WORKBENCH_TYPE_ICONS } from "../../../../components/type-icons"

const WORKBENCH_TYPES = [
  { value: "all", label: "All" },
  { value: "worktree", label: "Worktree" },
  { value: "container", label: "Container" },
  { value: "vm", label: "VM" },
  { value: "preview-build", label: "Preview Build" },
  { value: "preview-dev", label: "Preview Dev" },
  { value: "namespace", label: "Namespace" },
  { value: "pod", label: "Pod" },
  { value: "sandbox", label: "Sandbox" },
]

const COLUMNS: ColumnDef[] = [
  { label: "Name", key: "name", sortable: true },
  { label: "Type", key: "type", sortable: true },
  { label: "Phase", key: "spec.lifecycle", sortable: true },
  { label: "Host", key: "hostId" },
  { label: "Created", key: "createdAt", sortable: true },
  { label: "", className: "w-12" },
]

const getItems = async (filters: Record<string, any>) => {
  const res = await opsFetch<{ success: boolean; data: Workbench[] }>(
    "/workbenches?limit=500"
  )
  let items = res.data
  if (filters.searchTerm) {
    const q = filters.searchTerm.toLowerCase()
    items = items.filter(
      (w) =>
        w.name.toLowerCase().includes(q) || w.slug.toLowerCase().includes(q)
    )
  }
  if (filters.type && filters.type !== "all") {
    items = items.filter((w) => w.type === filters.type)
  }
  return items
}

function WorkbenchRow({ item }: { item: Workbench }) {
  const icon =
    WORKBENCH_TYPE_ICONS[item.type] ?? "icon-[ph--terminal-window-duotone]"
  const lifecycle = (item.spec?.lifecycle as string) ?? "unknown"
  const host = item.hostId ?? "—"

  return (
    <TableRow>
      <TableCell className="font-medium">
        <Link
          to={`/ops/workbenches/${item.slug}`}
          className="hover:text-primary hover:underline inline-flex items-center gap-1.5"
        >
          <Icon icon={icon} className="text-base text-muted-foreground" />
          {item.name}
        </Link>
      </TableCell>
      <TableCell className="text-muted-foreground">{item.type}</TableCell>
      <TableCell>
        <StatusBadge status={lifecycle} />
      </TableCell>
      <TableCell className="text-muted-foreground">{host}</TableCell>
      <TableCell className="text-muted-foreground">
        {new Date(item.createdAt).toLocaleDateString()}
      </TableCell>
      <TableCell><OpsActionMenu entityPath="workbenches" entityId={item.id} /></TableCell>
    </TableRow>
  )
}

export default function WorkbenchesPage() {
  return (
    <DashboardPage
      flush
      plane="ops"
      title="Workbenches"
      description="Development and execution environments — containers, VMs, and previews"
    >
      <ItemsProvider
        getItems={getItems}
        itemType="workbench"
        initialViewMode="list"
      >
        <ItemsPage>
          <ItemsView>
            <ItemsToolbar>
              <ItemsSearchbar placeholder="Search workbenches..." />
              <ItemsSelectFilter
                name="type"
                label="Type"
                options={WORKBENCH_TYPES}
              />
            </ItemsToolbar>
            <ItemsContent>
              <ItemsListView
                columns={COLUMNS}
                itemComponent={WorkbenchRow}
              />
            </ItemsContent>
          </ItemsView>
        </ItemsPage>
      </ItemsProvider>
    </DashboardPage>
  )
}
