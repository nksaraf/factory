import { Link } from "react-router"

import { TableCell, TableRow, TableHead } from "@rio.js/ui/table"

import { DashboardPage } from "@/components/factory"
import { ItemsProvider } from "@rio.js/app-ui/components/items/items-provider"
import { ItemsPage } from "@rio.js/app-ui/components/items/items-page"
import { ItemsContent } from "@rio.js/app-ui/components/items/items-content"
import { ItemsToolbar } from "@rio.js/app-ui/components/items/items-toolbar"
import { ItemsSearchbar } from "@rio.js/app-ui/components/items/items-searchbar"
import { ItemsListView } from "@rio.js/app-ui/components/items/items-list/items-list-view"

import { infraFetch } from "@/lib/infra"
import type { Secret } from "@/lib/infra/types"

import { InfraActionMenu } from "../../../../components/infra-action-menu"

function formatDate(dateStr: unknown): string {
  if (!dateStr || typeof dateStr !== "string") return "\u2014"
  return new Date(dateStr).toLocaleDateString()
}

const getItems = async (filters: Record<string, any>) => {
  const res = await infraFetch<{ success: boolean; data: Secret[] }>(
    "/secrets?limit=500"
  )
  let items = res.data
  if (filters.searchTerm) {
    const q = filters.searchTerm.toLowerCase()
    items = items.filter(
      (e) =>
        e.name.toLowerCase().includes(q) || e.slug.toLowerCase().includes(q)
    )
  }
  return items
}

const ListHeader = (
  <TableRow>
    <TableHead>Name</TableHead>
    <TableHead>Owner Type</TableHead>
    <TableHead>Rotation</TableHead>
    <TableHead>Last Rotated</TableHead>
    <TableHead>Expires</TableHead>
    <TableHead className="w-12" />
  </TableRow>
)

function SecretRow({ item }: { item: Secret }) {
  const spec = item.spec as Record<string, any>
  return (
    <TableRow>
      <TableCell>
        <Link
          to={`/infra/secrets/${item.slug}`}
          className="font-medium hover:text-primary hover:underline"
        >
          {item.name}
        </Link>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {spec.ownerType ?? <span>&mdash;</span>}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {spec.rotationPolicy ?? <span>&mdash;</span>}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {formatDate(spec.lastRotatedAt)}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {formatDate(spec.expiresAt)}
      </TableCell>
      <TableCell>
        <InfraActionMenu entityPath="secrets" entityId={item.id} />
      </TableCell>
    </TableRow>
  )
}

export default function SecretsPage() {
  return (
    <DashboardPage
      flush
      plane="infra"
      title="Secrets"
      description="Managed secrets, SSH keys, and rotation policies"
    >
      <ItemsProvider
        getItems={getItems}
        itemType="secrets"
        initialViewMode="list"
      >
        <ItemsPage>
          <ItemsToolbar>
            <ItemsSearchbar placeholder="Search secrets..." />
          </ItemsToolbar>
          <ItemsContent>
            <ItemsListView ListHeader={ListHeader} itemComponent={SecretRow} />
          </ItemsContent>
        </ItemsPage>
      </ItemsProvider>
    </DashboardPage>
  )
}
