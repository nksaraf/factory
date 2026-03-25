import { Button } from "@rio.js/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@rio.js/ui/dropdown-menu"
import { Icon } from "@rio.js/ui/icon"
import { Input } from "@rio.js/ui/input"

import {
  CREATE_RESOURCE_TYPES,
  RESOURCE_TYPE_CONFIG,
} from "../../constants/resource-config"
import { useCreateResource } from "../../data/use-create-resource"
import { useWorkspace } from "../workspace-context"

export function TreeToolbar({
  searchQuery,
  onSearchChange,
}: {
  searchQuery: string
  onSearchChange: (query: string) => void
}) {
  const { workspaceId } = useWorkspace()
  const createResource = useCreateResource(workspaceId)

  return (
    <div className="flex flex-col gap-2 border-b p-2">
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <Icon
            icon="icon-[ph--magnifying-glass]"
            className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Search resources..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-7 pl-7 pr-7 text-xs"
          />
          {searchQuery && (
            <button
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => onSearchChange("")}
            >
              <Icon icon="icon-[ph--x]" className="h-3 w-3" />
            </button>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
              <Icon icon="icon-[ph--plus]" className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {CREATE_RESOURCE_TYPES.map((type) => {
              const config = RESOURCE_TYPE_CONFIG[type]
              return (
                <DropdownMenuItem
                  key={type}
                  onClick={() =>
                    createResource.mutate({
                      name: `New ${config.label}`,
                      resourceType: type,
                    })
                  }
                >
                  <Icon
                    icon={config.icon}
                    className="mr-2 h-4 w-4"
                    style={{ color: config.color }}
                  />
                  {config.label}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
