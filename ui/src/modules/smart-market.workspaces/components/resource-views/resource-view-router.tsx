import { Suspense } from "react"

import { ExtensionView } from "@rio.js/app-ui/components/extension-view"
import { Icon } from "@rio.js/ui/icon"

import { RESOURCE_TYPE_CONFIG } from "../../constants/resource-config"
import type { ResourceDetail } from "../../types"

const VIEW_PREFIX = "smart-market.workspaces.views"

export function ResourceViewRouter({ resource }: { resource: ResourceDetail }) {
  const viewId = `${VIEW_PREFIX}.${resource.resourceType}`
  const config = RESOURCE_TYPE_CONFIG[resource.resourceType]

  if (!config) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Unknown resource type: {resource.resourceType}
      </div>
    )
  }

  // Views that render their own layout (WorkspaceLayout with menubar)
  // need to fill the full available space without a header bar.
  const isFullBleed =
    resource.resourceType === "map" || resource.resourceType === "dataset"

  if (isFullBleed) {
    return (
      <div className="h-full">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Loading view...
            </div>
          }
        >
          <ExtensionView src={viewId} props={{ resource }} />
        </Suspense>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Icon
          icon={config.icon}
          className="h-5 w-5"
          style={{ color: config.color }}
        />
        <h1 className="text-lg font-semibold">{resource.name}</h1>
        <span
          className="rounded-full px-2 py-0.5 text-xs font-medium"
          style={{ background: config.bg, color: config.color }}
        >
          {config.label}
        </span>
      </div>
      <div className="flex-1 overflow-auto">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Loading view...
            </div>
          }
        >
          <ExtensionView src={viewId} props={{ resource }} />
        </Suspense>
      </div>
    </div>
  )
}
