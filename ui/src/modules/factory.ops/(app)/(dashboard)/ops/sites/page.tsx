import { Link } from "react-router"

import { Icon } from "@rio.js/ui/icon"
import {
  ItemsTableCell as TableCell,
  ItemsTableRow as TableRow,
  ItemsTableHead as TableHead,
} from "@rio.js/app-ui/components/items/items-list/items-table"
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
import type { Site } from "@/lib/ops/types"
import { SITE_TYPE_ICONS } from "../../../../components/type-icons"

const SITE_TYPES = [
  { value: "all", label: "All" },
  { value: "production", label: "Production" },
  { value: "staging", label: "Staging" },
  { value: "preview", label: "Preview" },
  { value: "development", label: "Development" },
  { value: "sandbox", label: "Sandbox" },
  { value: "demo", label: "Demo" },
  { value: "feature-branch", label: "Feature Branch" },
  { value: "qat", label: "QAT" },
  { value: "test", label: "Test" },
]

const getItems = async (filters: Record<string, any>) => {
  const res = await opsFetch<{ success: boolean; data: Site[] }>(
    "/sites?limit=500"
  )
  let items = res.data
  if (filters.searchTerm) {
    const q = filters.searchTerm.toLowerCase()
    items = items.filter(
      (s) =>
        s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q)
    )
  }
  if (filters.type && filters.type !== "all") {
    items = items.filter((s) => s.type === filters.type)
  }
  return items
}

const ListHeader = (
  <TableRow>
    <TableHead>Name</TableHead>
    <TableHead>Type</TableHead>
    <TableHead>Product</TableHead>
    <TableHead>Phase</TableHead>
  </TableRow>
)

function SiteRow({ item }: { item: Site }) {
  const icon =
    SITE_TYPE_ICONS[item.type] ?? "icon-[ph--globe-hemisphere-west-duotone]"
  const phase = (item.status?.phase as string) ?? "unknown"
  const product = (item.spec?.product as string) ?? "—"

  return (
    <TableRow>
      <TableCell className="font-medium">
        <Link
          to={`/ops/sites/${item.slug}`}
          className="hover:text-primary hover:underline inline-flex items-center gap-1.5"
        >
          <Icon icon={icon} className="text-base text-muted-foreground" />
          {item.name}
        </Link>
      </TableCell>
      <TableCell className="text-muted-foreground">{item.type}</TableCell>
      <TableCell className="text-muted-foreground">{product}</TableCell>
      <TableCell>
        <StatusBadge status={phase} />
      </TableCell>
    </TableRow>
  )
}

export default function SitesPage() {
  return (
    <DashboardPage
      plane="ops"
      title="Sites"
      description="Deployment environments -- production, staging, preview, and development sites"
    >
      <ItemsProvider getItems={getItems} itemType="site" initialViewMode="list">
        <ItemsPage>
          <ItemsView>
            <ItemsToolbar>
              <ItemsSearchbar placeholder="Search sites..." />
              <ItemsSelectFilter
                name="type"
                label="Type"
                options={SITE_TYPES}
              />
            </ItemsToolbar>
            <ItemsContent>
              <ItemsListView ListHeader={ListHeader} itemComponent={SiteRow} />
            </ItemsContent>
          </ItemsView>
        </ItemsPage>
      </ItemsProvider>
    </DashboardPage>
  )
}
