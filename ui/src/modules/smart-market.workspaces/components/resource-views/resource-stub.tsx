import { Icon } from "@rio.js/ui/icon"

import type { ResourceDetail } from "../../types"

export function ResourceStub({
  resource,
  icon,
  description,
}: {
  resource: ResourceDetail
  icon: string
  description: string
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
      <Icon icon={icon} className="h-16 w-16 text-muted-foreground/20" />
      <div className="text-center">
        <p className="text-sm text-muted-foreground">{description}</p>
        <p className="mt-2 text-xs text-muted-foreground/60">
          Editor coming soon
        </p>
      </div>
      <div className="mt-4 rounded-lg border bg-muted/30 p-4 text-xs text-muted-foreground">
        <div className="grid grid-cols-2 gap-x-8 gap-y-1">
          <span className="font-medium">ID</span>
          <span className="font-mono">{resource.id}</span>
          <span className="font-medium">Type</span>
          <span>{resource.resourceType}</span>
          <span className="font-medium">Blocks</span>
          <span>{resource.blocks.length}</span>
          <span className="font-medium">Edges</span>
          <span>{resource.edges.length}</span>
          <span className="font-medium">Created</span>
          <span>{new Date(resource.createdAt).toLocaleDateString()}</span>
          <span className="font-medium">Updated</span>
          <span>{new Date(resource.updatedAt).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  )
}
