import { PanelLeftOpen } from "lucide-react"
import { useState } from "react"

import { Button } from "@rio.js/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@rio.js/ui/tooltip"

import { WorkspaceSidebar } from "../../../../../components/workspace-sidebar"

export default function FilesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true)

  return (
    <div className="flex w-full h-full">
      {sidebarOpen ? (
        <div className="w-72 shrink-0">
          <WorkspaceSidebar onCollapse={() => setSidebarOpen(false)} />
        </div>
      ) : (
        <div className="flex shrink-0 border-r">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="m-1.5 h-7 w-7"
                onClick={() => setSidebarOpen(true)}
              >
                <PanelLeftOpen className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Expand sidebar</TooltipContent>
          </Tooltip>
        </div>
      )}
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  )
}
