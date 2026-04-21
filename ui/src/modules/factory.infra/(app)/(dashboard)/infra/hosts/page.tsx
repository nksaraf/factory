import { Link } from "react-router"

import { cn } from "@rio.js/ui/lib/utils"
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
import { ItemsListView } from "@rio.js/app-ui/components/items/items-list/items-list-view"
import type { ColumnDef } from "@rio.js/app-ui/components/items/items-list/items-list-view"
import { useItemsContext } from "@rio.js/app-ui/components/items/items-list/items-list-view"

import { DashboardPage, StatusBadge } from "@/components/factory"
import { infraFetch } from "@/lib/infra"
import type { Host } from "@/lib/infra/types"
import { HOST_TYPE_ICONS } from "../../../../components/type-icons"
import { CopyCell } from "../../../../components/copy-cell"
import { InfraActionMenu } from "../../../../components/infra-action-menu"

const COLUMNS: ColumnDef[] = [
  { label: "Name", key: "name", sortable: true },
  { label: "Type", key: "type", sortable: true },
  { label: "IP", key: "spec.ipAddress", sortable: true },
  { label: "OS", key: "spec.os", sortable: true },
  { label: "CPU", key: "spec.cpu", sortable: true },
  { label: "Mem", key: "spec.memoryMb", sortable: true },
  { label: "Disk", key: "spec.diskGb", sortable: true },
  { label: "Status", key: "spec.lifecycle", sortable: true },
  { label: "", className: "w-12" },
]

const HOST_TYPES = [
  { value: "all", label: "All" },
  { value: "bare-metal", label: "bare-metal", icon: "icon-[ph--desktop-tower-duotone]" },
  { value: "vm", label: "vm", icon: "icon-[ph--monitor-duotone]" },
  { value: "lxc", label: "lxc", icon: "icon-[ph--package-duotone]" },
  { value: "cloud-instance", label: "cloud-instance", icon: "icon-[ph--cloud-duotone]" },
  { value: "network-appliance", label: "network-appliance", icon: "icon-[ph--router-duotone]" },
]

function formatMem(mb: unknown): string {
  const val = Number(mb) || 0
  return val > 0 ? `${Math.round(val / 1024)}G` : "—"
}

function formatDisk(gb: unknown): string {
  const val = Number(gb) || 0
  return val > 0 ? `${val}G` : "—"
}

function formatCpu(cpu: unknown): string {
  const val = Number(cpu) || 0
  return val > 0 ? `${val}c` : "—"
}

const getItems = async (filters: Record<string, any>) => {
  const res = await infraFetch<{ success: boolean; data: Host[] }>("/hosts?limit=500")
  let items = res.data
  if (filters.searchTerm) {
    const q = filters.searchTerm.toLowerCase()
    items = items.filter(
      (h) =>
        h.name.toLowerCase().includes(q) ||
        h.slug.toLowerCase().includes(q) ||
        ((h.spec.ipAddress as string) ?? "").includes(q),
    )
  }
  if (filters.type && filters.type !== "all") {
    items = items.filter((h) => h.type === filters.type)
  }
  return items
}

function HostRow({ item }: { item: Host }) {
  const icon = HOST_TYPE_ICONS[item.type] ?? "icon-[ph--desktop-tower-duotone]"
  const lifecycle = (item.spec.lifecycle as string) ?? "unknown"

  return (
    <TableRow>
      <TableCell className="font-medium">
        <Link
          to={`/infra/hosts/${item.slug}`}
          className="hover:text-primary hover:underline inline-flex items-center gap-1.5"
        >
          <Icon icon={icon} className="text-base text-muted-foreground" />
          {item.name}
        </Link>
      </TableCell>
      <TableCell className="text-muted-foreground">{item.type}</TableCell>
      <TableCell>
        <CopyCell value={(item.spec.ipAddress as string) || null} />
      </TableCell>
      <TableCell className="text-muted-foreground">
        {(item.spec.os as string) || "—"}
      </TableCell>
      <TableCell className="font-mono text-muted-foreground">
        {formatCpu(item.spec.cpu)}
      </TableCell>
      <TableCell className="font-mono text-muted-foreground">
        {formatMem(item.spec.memoryMb)}
      </TableCell>
      <TableCell className="font-mono text-muted-foreground">
        {formatDisk(item.spec.diskGb)}
      </TableCell>
      <TableCell>
        <StatusBadge status={lifecycle} />
      </TableCell>
      <TableCell>
        <InfraActionMenu entityPath="hosts" entityId={item.id} />
      </TableCell>
    </TableRow>
  )
}

function HostTypeFilter() {
  const { filters, setFilter } = useItemsContext()
  const currentType = (filters.type as string) ?? "all"

  return (
    <div className="flex gap-1 rounded-lg border bg-muted p-1">
      {HOST_TYPES.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => setFilter("type", t.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors inline-flex items-center gap-1.5",
            currentType === t.value
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {"icon" in t && t.icon && <Icon icon={t.icon} className="text-sm" />}
          {t.label}
        </button>
      ))}
    </div>
  )
}

export default function HostsPage() {
  return (
    <DashboardPage
      flush
      plane="infra"
      title="Hosts"
      description="Bare-metal hosts, virtual machines, and network appliances"
    >
      <ItemsProvider getItems={getItems} itemType="host" initialViewMode="list">
        <ItemsPage>
          <ItemsView>
            <ItemsToolbar>
              <HostTypeFilter />
              <ItemsSearchbar placeholder="Search hosts..." />
            </ItemsToolbar>
            <ItemsContent>
              <ItemsListView columns={COLUMNS} itemComponent={HostRow} />
            </ItemsContent>
          </ItemsView>
        </ItemsPage>
      </ItemsProvider>
    </DashboardPage>
  )
}
