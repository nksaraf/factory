import { Link } from "react-router"

import {
  ItemsTableCell as TableCell,
  ItemsTableRow as TableRow,
} from "@rio.js/app-ui/components/items/items-list/items-table"
import { ItemsProvider } from "@rio.js/app-ui/components/items/items-provider"
import { ItemsPage } from "@rio.js/app-ui/components/items/items-page"
import { ItemsContent } from "@rio.js/app-ui/components/items/items-content"
import { ItemsToolbar } from "@rio.js/app-ui/components/items/items-toolbar"
import { ItemsSearchbar } from "@rio.js/app-ui/components/items/items-searchbar"
import { ItemsSelectFilter } from "@rio.js/app-ui/components/items/items-select-filter"
import { ItemsListView } from "@rio.js/app-ui/components/items/items-list/items-list-view"
import type { ColumnDef } from "@rio.js/app-ui/components/items/items-list/items-list-view"

import { DashboardPage, StatusBadge } from "@/components/factory"
import { infraFetch } from "@/lib/infra"
import type { Tunnel } from "@/lib/infra/types"

import { InfraActionMenu } from "../../../../components/infra-action-menu"

const PHASE_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Connected", value: "connected" },
  { label: "Connecting", value: "connecting" },
  { label: "Disconnected", value: "disconnected" },
  { label: "Error", value: "error" },
]

const getItems = async (filters: Record<string, any>) => {
  const res = await infraFetch<{ success: boolean; data: Tunnel[] }>(
    "/tunnels?limit=500"
  )
  let items = res.data
  if (filters.searchTerm) {
    const q = filters.searchTerm.toLowerCase()
    items = items.filter((e) => e.subdomain.toLowerCase().includes(q))
  }
  if (filters.phase && filters.phase !== "all") {
    items = items.filter((e) => e.phase === filters.phase)
  }
  return items
}

const COLUMNS: ColumnDef[] = [
  { label: "Subdomain", key: "subdomain", sortable: true },
  { label: "Type", key: "type", sortable: true },
  { label: "Phase", key: "phase", sortable: true },
  { label: "Local Port", key: "spec.localPort", sortable: true },
  { label: "Remote Port", key: "spec.remotePort", sortable: true },
  { label: "", className: "w-12" },
]

function TunnelRow({ item }: { item: Tunnel }) {
  const spec = item.spec as Record<string, any>
  return (
    <TableRow>
      <TableCell>
        <Link
          to={`/infra/tunnels/${item.id}`}
          className="font-medium hover:text-primary hover:underline"
        >
          {item.subdomain}
        </Link>
      </TableCell>
      <TableCell className="text-muted-foreground">{item.type}</TableCell>
      <TableCell>
        <StatusBadge status={item.phase} />
      </TableCell>
      <TableCell className="font-mono">
        {spec.localPort ?? (
          <span className="text-muted-foreground">&mdash;</span>
        )}
      </TableCell>
      <TableCell className="font-mono">
        {spec.remotePort ?? (
          <span className="text-muted-foreground">&mdash;</span>
        )}
      </TableCell>
      <TableCell>
        <InfraActionMenu entityPath="tunnels" entityId={item.id} />
      </TableCell>
    </TableRow>
  )
}

export default function TunnelsPage() {
  return (
    <DashboardPage
      flush
      plane="infra"
      title="Tunnels"
      description="Developer tunnels bridging local services to routes"
    >
      <ItemsProvider
        getItems={getItems}
        itemType="tunnels"
        initialViewMode="list"
      >
        <ItemsPage>
          <ItemsToolbar>
            <ItemsSearchbar placeholder="Search tunnels..." />
            <ItemsSelectFilter
              name="phase"
              label="Phase"
              options={PHASE_OPTIONS}
            />
          </ItemsToolbar>
          <ItemsContent>
            <ItemsListView columns={COLUMNS} itemComponent={TunnelRow} />
          </ItemsContent>
        </ItemsPage>
      </ItemsProvider>
    </DashboardPage>
  )
}
