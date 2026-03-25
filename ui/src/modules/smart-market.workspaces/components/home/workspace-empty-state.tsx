import { Link } from "react-router"

import { Button } from "@rio.js/ui/button"
import { Icon } from "@rio.js/ui/icon"

import { useWorkspace } from "../workspace-context"

export function WorkspaceEmptyState() {
  const { workspaceId } = useWorkspace()

  return (
    <div className="flex flex-col items-center py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
        <Icon
          icon="icon-[ph--sparkle-duotone]"
          className="h-6 w-6 text-muted-foreground"
        />
      </div>
      <h2 className="mt-4 text-lg font-medium">Your workspace is ready</h2>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        Create maps, datasets, and reports — or let AI help you explore your
        data.
      </p>
      <div className="mt-6 flex gap-3">
        <Button size="sm" asChild>
          <Link to={`/w/${workspaceId}/files/`}>
            <Icon icon="icon-[ph--plus-bold]" className="mr-1.5 h-3.5 w-3.5" />
            Create a resource
          </Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link to={`/scouts/${workspaceId}/`}>
            <Icon
              icon="icon-[ph--robot-duotone]"
              className="mr-1.5 h-3.5 w-3.5"
            />
            Explore with AI
          </Link>
        </Button>
      </div>
    </div>
  )
}
