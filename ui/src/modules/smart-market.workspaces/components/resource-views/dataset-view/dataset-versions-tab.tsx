import { GitCompare } from "lucide-react"

import type { ResourceDetail } from "../../../types"

export function DatasetVersionsTab({ resource }: { resource: ResourceDetail }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <GitCompare className="h-12 w-12 opacity-30" />
      <p className="text-sm">Versions</p>
      <p className="text-xs opacity-60">
        Version history and diff view coming soon
      </p>
    </div>
  )
}
