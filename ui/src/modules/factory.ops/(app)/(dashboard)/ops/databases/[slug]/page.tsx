import { useDatabase } from "@/lib/ops"
import { useParams } from "react-router"

import {
  EmptyState,
  MetricCard,
  PageHeader,
  StatusBadge,
} from "@/components/factory"

import { OpsActionMenu } from "../../../../../components/ops-action-menu"

export default function DatabaseDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: db, isLoading } = useDatabase(slug)

  if (isLoading)
    return <p className="p-6 text-sm text-muted-foreground">Loading...</p>
  if (!db)
    return (
      <EmptyState
        title="Database not found"
        description={`No database with slug "${slug}"`}
      />
    )

  const engine = (db.spec?.engine as string) ?? "unknown"
  const version = (db.spec?.version as string) ?? "\u2014"
  const provisionMode = (db.spec?.provisionMode as string) ?? "\u2014"
  const status = (db.spec?.status as string) ?? "unknown"

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        pageGroup="ops"
        title={db.name}
        description={`${engine} database`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            <OpsActionMenu entityPath="databases" entityId={db.id} />
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Engine" value={engine} plane="ops" />
        <MetricCard label="Version" value={version} plane="ops" />
        <MetricCard label="Provision Mode" value={provisionMode} plane="ops" />
        <MetricCard label="Status" value={status} plane="ops" />
      </div>
    </div>
  )
}
