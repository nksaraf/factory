import { useDeferredValue } from "react"

import { useResource } from "../data/use-resource"
import { EmptyState } from "./empty-state"
import { ResourceViewRouter } from "./resource-views/resource-view-router"

export function WorkspaceContent({ resourceId }: { resourceId?: string }) {
  // Defer the resource ID so the previous view stays visible while the new
  // resource data loads, avoiding a flash to the loading skeleton.
  const deferredResourceId = useDeferredValue(resourceId)
  const isPending = deferredResourceId !== resourceId

  const { data: resource, isLoading } = useResource(deferredResourceId)

  if (!resourceId) {
    return <EmptyState />
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading resource...
      </div>
    )
  }

  if (!resource) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Resource not found
      </div>
    )
  }

  return (
    <div
      className={`h-full relative ${isPending ? "opacity-70 transition-opacity" : ""}`}
    >
      <ResourceViewRouter resource={resource} />
    </div>
  )
}
