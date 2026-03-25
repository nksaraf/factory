import { Check } from "lucide-react"
import { useState } from "react"
import { useLocation, useParams } from "react-router"

import { useApp } from "@rio.js/app-ui/hooks/use-app"
import { Button } from "@rio.js/ui/button"
import { cn } from "@rio.js/ui/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@rio.js/ui/popover"

import { useWorkspaces } from "../data/use-workspaces"

function getCurrentSection(pathname: string, workspaceId: string): string {
  // Check scouts route pattern: /scouts/:spaceSlug/...
  if (pathname.startsWith(`/scouts/${workspaceId}`)) return "scouts"
  // Check workspace route pattern: /w/:workspaceId/...
  const prefix = `/w/${workspaceId}/`
  const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : ""
  if (rest.startsWith("files")) return "files"
  return "scouts"
}

export function WorkspacePicker() {
  const [open, setOpen] = useState(false)
  const { workspaceId, spaceSlug } = useParams<{
    workspaceId?: string
    spaceSlug?: string
  }>()
  const activeId = workspaceId ?? spaceSlug
  const { data: workspaces } = useWorkspaces()
  const location = useLocation()
  const app = useApp()

  const current = workspaces?.find((w) => w.id === activeId)
  const section = activeId
    ? getCurrentSection(location.pathname, activeId)
    : "scouts"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          iconRight="icon-[lucide--chevron-down]"
          className="h-8 min-w-0 flex-1 justify-between gap-1.5 px-2 text-sm font-semibold"
        >
          {current?.name ?? "Select workspace"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          Workspaces
        </div>
        {workspaces?.map((ws) => (
          <button
            key={ws.id}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
              ws.id === activeId && "bg-accent"
            )}
            onClick={() => {
              const target =
                section === "scouts"
                  ? `/scouts/${ws.id}/`
                  : `/w/${ws.id}/${section}/`
              app.navigate(target)
              setOpen(false)
            }}
          >
            <span className="min-w-0 flex-1 truncate text-left">{ws.name}</span>
            {ws.id === activeId && <Check className="h-3.5 w-3.5 shrink-0" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
