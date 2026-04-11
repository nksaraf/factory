import { useState } from "react"

import { Button } from "@rio.js/ui/button"
import { Icon } from "@rio.js/ui/icon"
import { Skeleton } from "@rio.js/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@rio.js/ui/tooltip"

import { ResourceTree } from "./resource-tree/resource-tree"
import { TreeToolbar } from "./resource-tree/tree-toolbar"
import { useWorkbench } from "./workbench-context"
import { WorkspacePicker } from "./workspace-picker"

function TreeSkeleton() {
  // Mimic a realistic tree shape: folders with children at varying depths
  const rows = [
    { indent: 0, width: "w-24" },
    { indent: 1, width: "w-20" },
    { indent: 1, width: "w-28" },
    { indent: 2, width: "w-16" },
    { indent: 0, width: "w-20" },
    { indent: 1, width: "w-24" },
    { indent: 0, width: "w-16" },
  ]

  return (
    <div className="space-y-0.5 py-2 px-1">
      {rows.map((row, i) => (
        <div
          key={i}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 animate-in fade-in duration-300"
          style={{
            paddingLeft: `${(row.indent + 1) * 16}px`,
            animationDelay: `${i * 50}ms`,
            animationFillMode: "backwards",
          }}
        >
          <Skeleton className="h-3.5 w-3.5 rounded" />
          <Skeleton className={`h-3 ${row.width} rounded`} />
        </div>
      ))}
    </div>
  )
}

export function WorkspaceSidebar({ onCollapse }: { onCollapse?: () => void }) {
  const { isLoading } = useWorkbench()
  const [searchQuery, setSearchQuery] = useState("")

  return (
    <div className="flex h-full flex-col border-r bg-background">
      <div className="flex items-center gap-1 border-b px-1.5 py-1.5">
        <WorkspacePicker />
        {onCollapse && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground"
                onClick={onCollapse}
              >
                <Icon
                  icon="icon-[ph--sidebar-simple-duotone]"
                  className="h-4 w-4"
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Collapse sidebar</TooltipContent>
          </Tooltip>
        )}
      </div>
      <TreeToolbar searchQuery={searchQuery} onSearchChange={setSearchQuery} />
      <div className="flex-1 overflow-hidden px-1">
        {isLoading ? (
          <TreeSkeleton />
        ) : (
          <ResourceTree searchQuery={searchQuery} />
        )}
      </div>
    </div>
  )
}
