import { Link } from "react-router"

import { Button } from "@rio.js/ui/button"
import { Icon } from "@rio.js/ui/icon"

import { useWorkspaces } from "../../data/use-workspaces"
import { useWorkbench } from "../workbench-context"

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

export function WorkspaceHomeHeader() {
  const { workspaceId } = useWorkbench()
  const { data: workspaces } = useWorkspaces()
  const activeWorkbench = workspaces?.find((w) => w.id === workspaceId)

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{getGreeting()}</p>
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight">
          {activeWorkbench?.name ?? "Workbench"}
        </h1>
        {activeWorkbench?.description && (
          <p className="mt-1 text-sm text-muted-foreground">
            {activeWorkbench.description}
          </p>
        )}
      </div>
      <Button variant="outline" size="sm" asChild>
        <Link to={`/w/${workspaceId}/files/`}>
          <Icon
            icon="icon-[ph--folder-open-duotone]"
            className="mr-1.5 h-3.5 w-3.5"
          />
          All files
        </Link>
      </Button>
    </div>
  )
}
