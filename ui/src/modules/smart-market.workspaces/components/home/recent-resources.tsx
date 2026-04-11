import { useMemo } from "react"
import { Link } from "react-router"

import { Icon } from "@rio.js/ui/icon"
import { fromNow } from "@rio.js/ui/lib/fromnow"

import { RESOURCE_TYPE_CONFIG } from "../../constants/resource-config"
import { useWorkbench } from "../workbench-context"

export function RecentResources() {
  const { workspaceId, resources } = useWorkbench()

  const recent = useMemo(() => {
    return resources
      .filter((r) => r.resourceType !== "folder" && !r.deletedAt)
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      .slice(0, 6)
  }, [resources])

  if (recent.length === 0) return null

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">Pick up where you left off</h2>
        <Link
          to={`/w/${workspaceId}/files/`}
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          View all
          <Icon icon="icon-[ph--arrow-right]" className="h-3 w-3" />
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {recent.map((resource) => {
          const config = RESOURCE_TYPE_CONFIG[resource.resourceType]
          return (
            <Link
              key={resource.id}
              to={`/w/${workspaceId}/files/${resource.id}/`}
              className="group flex items-center gap-3 rounded-lg border bg-card p-3 transition-all hover:border-foreground/15 hover:shadow-sm"
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${config.bgClass}`}
              >
                <Icon
                  icon={config.icon}
                  className={`h-4 w-4 ${config.iconClass}`}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{resource.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {config.label} · {fromNow(resource.updatedAt)}
                </p>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
