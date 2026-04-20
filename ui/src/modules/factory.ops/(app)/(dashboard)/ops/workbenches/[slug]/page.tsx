import { useWorkbench } from "@/lib/ops"
import { useParams } from "react-router"

import {
  EmptyState,
  MetricCard,
  PageHeader,
  StatusBadge,
} from "@/components/factory"

import { OpsActionMenu } from "../../../../../components/ops-action-menu"

export default function WorkbenchDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: wb, isLoading } = useWorkbench(slug)

  if (isLoading)
    return <p className="p-6 text-sm text-muted-foreground">Loading...</p>
  if (!wb)
    return (
      <EmptyState
        title="Workbench not found"
        description={`No workbench with slug "${slug}"`}
      />
    )

  const lifecycle = (wb.spec?.lifecycle as string) ?? "unknown"
  const cpu = (wb.spec?.cpu as string) ?? "\u2014"
  const memory = (wb.spec?.memory as string) ?? "\u2014"
  const storageGb = (wb.spec?.storageGb as number) ?? 0
  const healthStatus = (wb.spec?.healthStatus as string) ?? "unknown"
  const accessMethod = (wb.spec?.accessMethod as string) ?? "\u2014"
  const webTerminalUrl = wb.spec?.webTerminalUrl as string | undefined
  const sshHost = wb.spec?.sshHost as string | undefined
  const sshPort = wb.spec?.sshPort as number | undefined

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        pageGroup="ops"
        title={wb.name}
        description={`${wb.type} workbench`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={lifecycle} />
            <OpsActionMenu entityPath="workbenches" entityId={wb.id} />
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="Type" value={wb.type} plane="ops" />
        <MetricCard label="CPU" value={cpu} plane="ops" />
        <MetricCard label="Memory" value={memory} plane="ops" />
        <MetricCard
          label="Storage"
          value={storageGb > 0 ? `${storageGb}G` : "\u2014"}
          plane="ops"
        />
        <MetricCard label="Health" value={healthStatus} plane="ops" />
        <MetricCard label="Access" value={accessMethod} plane="ops" />
      </div>

      {(sshHost || webTerminalUrl) && (
        <div>
          <h2 className="mb-2 text-lg font-semibold">Access</h2>
          <div className="space-y-2">
            {sshHost && (
              <div className="rounded-lg border bg-card p-3">
                <p className="text-sm text-muted-foreground">SSH</p>
                <p className="font-mono text-base">
                  {sshHost}
                  {sshPort ? `:${sshPort}` : ""}
                </p>
              </div>
            )}
            {webTerminalUrl && (
              <div className="rounded-lg border bg-card p-3">
                <p className="text-sm text-muted-foreground">Web Terminal</p>
                <a
                  href={webTerminalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-base text-primary hover:underline"
                >
                  {webTerminalUrl}
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
