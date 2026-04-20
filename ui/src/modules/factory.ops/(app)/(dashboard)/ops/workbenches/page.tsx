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
import type { Workbench } from "@/lib/ops/types"
import { WORKBENCH_TYPE_ICONS } from "../../../../components/type-icons"
import { OpsActionMenu } from "../../../../components/ops-action-menu"

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

const ListHeader = (
  <TableRow>
    <TableHead>Name</TableHead>
    <TableHead>Type</TableHead>
    <TableHead>Owner</TableHead>
    <TableHead>Lifecycle</TableHead>
    <TableHead className="w-12" />
  </TableRow>
)

function WorkbenchRow({ item }: { item: Workbench }) {
  const icon =
    WORKBENCH_TYPE_ICONS[item.type] ?? "icon-[ph--terminal-window-duotone]"
  const lifecycle = (item.spec?.lifecycle as string) ?? "unknown"

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
      <TableCell className="text-muted-foreground">{item.ownerId}</TableCell>
      <TableCell>
        <StatusBadge status={lifecycle} />
      </TableCell>
      <TableCell>
        <OpsActionMenu entityPath="workbenches" entityId={item.id} />
      </TableCell>
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
                ListHeader={ListHeader}
                itemComponent={WorkbenchRow}
              />
            </ItemsContent>
          </ItemsView>
        </ItemsPage>
      </ItemsProvider>
    </DashboardPage>
  )
}
