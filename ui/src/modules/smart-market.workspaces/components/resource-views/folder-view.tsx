import { useNavigate, useParams } from "react-router"

import { Icon } from "@rio.js/ui/icon"

import { RESOURCE_TYPE_CONFIG } from "../../constants/resource-config"
import type { ResourceDetail } from "../../types"
import { useWorkspace } from "../workspace-context"

export default function FolderView({ resource }: { resource: ResourceDetail }) {
  const { resources } = useWorkspace()
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()

  const children = resources.filter((r) => r.parentId === resource.id)

  return (
    <div className="p-4">
      {children.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          This folder is empty
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {children.map((child) => {
            const config = RESOURCE_TYPE_CONFIG[child.resourceType]
            return (
              <button
                key={child.id}
                className="flex flex-col items-center gap-2 rounded-lg border p-4 text-left hover:bg-accent transition-colors"
                onClick={() => navigate(`/w/${workspaceId}/files/${child.id}`)}
              >
                <Icon
                  icon={config.icon}
                  className="h-8 w-8"
                  style={{ color: config.color }}
                />
                <span className="text-sm font-medium truncate w-full text-center">
                  {child.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {config.label}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
