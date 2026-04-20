import { useLocation } from "../hooks/use-queries.js"

function Card({
  label,
  title,
  children,
}: {
  label: string
  title: string
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="mt-1 font-mono text-sm">{title}</div>
      {children && <div className="mt-2 text-xs text-zinc-400">{children}</div>}
    </div>
  )
}

export function LocationPage() {
  const { data, isLoading } = useLocation()
  if (isLoading) return <div className="text-sm text-zinc-500">Loading…</div>
  if (!data) return null

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Location</h1>
      <p className="text-sm text-zinc-500 -mt-3">
        Where this dev session is running.
      </p>

      <div className="grid md:grid-cols-2 gap-3">
        <Card label="Estate" title={data.estate?.name ?? "unknown"}>
          Owner/organization context (resolved from Factory — not available
          locally yet).
        </Card>

        <Card label="Host" title={data.host.name}>
          <div>
            {data.host.os}/{data.host.arch}
          </div>
          <div className="truncate">IPs: {data.host.ips.join(", ") || "—"}</div>
          <div className="truncate">factory: {data.host.factoryUrl}</div>
        </Card>

        <Card
          label="Realm"
          title={data.realm ? `${data.realm.type}: ${data.realm.name}` : "—"}
        />

        <Card label="Site" title={data.site.slug}>
          type: {data.site.type}
        </Card>

        <Card label="Workbench" title={data.workbench.name}>
          <div>kind: {data.workbench.kind}</div>
          {data.workbench.branch && <div>branch: {data.workbench.branch}</div>}
          {data.workbench.dir && (
            <div className="truncate">dir: {data.workbench.dir}</div>
          )}
          {data.workbench.tunnelSubdomain && (
            <div>tunnel: {data.workbench.tunnelSubdomain}</div>
          )}
        </Card>

        <Card label="Project" title={data.project.name}>
          <div className="truncate">root: {data.project.rootDir}</div>
          <div className="truncate">
            compose: {data.project.composeFiles.join(", ") || "—"}
          </div>
        </Card>

        {data.package && (
          <Card label="Package" title={data.package.name}>
            <div>type: {data.package.type}</div>
            <div className="truncate">dir: {data.package.dir}</div>
          </Card>
        )}
      </div>
    </div>
  )
}
