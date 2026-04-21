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
import { infraFetch } from "@/lib/infra"
import type { Realm } from "@/lib/infra/types"
import { REALM_TYPE_ICONS } from "../../../../components/type-icons"
import { InfraActionMenu } from "../../../../components/infra-action-menu"

const REALM_TYPES = [
  { value: "all", label: "All" },
  { value: "k8s-cluster", label: "K8s Cluster" },
  { value: "docker-engine", label: "Docker Engine" },
  { value: "compose-project", label: "Compose Project" },
  { value: "systemd", label: "Systemd" },
  { value: "reverse-proxy", label: "Reverse Proxy" },
  { value: "proxmox", label: "Proxmox" },
]

const getItems = async (filters: Record<string, any>) => {
  const res = await infraFetch<{ success: boolean; data: Realm[] }>(
    "/realms?limit=500"
  )
  let items = res.data
  if (filters.searchTerm) {
    const q = filters.searchTerm.toLowerCase()
    items = items.filter(
      (r) =>
        r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q)
    )
  }
  if (filters.type && filters.type !== "all") {
    items = items.filter((r) => r.type === filters.type)
  }
  return items
}

const COLUMNS: ColumnDef[] = [
  { label: "Name", key: "name", sortable: true },
  { label: "Type", key: "type", sortable: true },
  { label: "Category", key: "spec.category", sortable: true },
  { label: "Status", key: "spec.status", sortable: true },
  { label: "Version", key: "spec.version", sortable: true },
  { label: "", className: "w-12" },
]

function RealmRow({ item }: { item: Realm }) {
  const icon = REALM_TYPE_ICONS[item.type] ?? "icon-[ph--gear-six-duotone]"
  const category = (item.spec.category as string) ?? "\u2014"
  const status = (item.spec.status as string) ?? "unknown"
  const version = (item.spec.version as string) ?? "\u2014"

  return (
    <TableRow>
      <TableCell className="font-medium">
        <Link
          to={`/infra/realms/${item.slug}`}
          className="hover:text-primary hover:underline inline-flex items-center gap-1.5"
        >
          <Icon icon={icon} className="text-base text-muted-foreground" />
          {item.name}
        </Link>
      </TableCell>
      <TableCell className="text-muted-foreground">{item.type}</TableCell>
      <TableCell className="text-muted-foreground">{category}</TableCell>
      <TableCell>
        <StatusBadge status={status} />
      </TableCell>
      <TableCell className="font-mono text-muted-foreground">
        {version}
      </TableCell>
      <TableCell>
        <InfraActionMenu entityPath="realms" entityId={item.id} />
      </TableCell>
    </TableRow>
  )
}

export default function RealmsPage() {
  return (
    <DashboardPage
      flush
      plane="infra"
      title="Realms"
      description="Compute, network, storage, and scheduling domains"
    >
      <ItemsProvider
        getItems={getItems}
        itemType="realm"
        initialViewMode="list"
      >
        <ItemsPage>
          <ItemsView>
            <ItemsToolbar>
              <ItemsSearchbar placeholder="Search realms..." />
              <ItemsSelectFilter
                name="type"
                label="Type"
                options={REALM_TYPES}
              />
            </ItemsToolbar>
            <ItemsContent>
              <ItemsListView columns={COLUMNS} itemComponent={RealmRow} />
            </ItemsContent>
          </ItemsView>
        </ItemsPage>
      </ItemsProvider>
    </DashboardPage>
  )
}
