import { useEffect, useRef, useState } from "react"

import { Button } from "@rio.js/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@rio.js/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@rio.js/ui/dropdown-menu"
import { Icon } from "@rio.js/ui/icon"
import { Input } from "@rio.js/ui/input"

import {
  CREATE_RESOURCE_TYPES,
  RESOURCE_TYPE_CONFIG,
} from "../../constants/resource-config"
import { useCreateResource } from "../../data/use-create-resource"
import { useDeleteResource } from "../../data/use-delete-resource"
import { useUpdateResource } from "../../data/use-update-resource"
import type { Resource } from "../../types"
import { useWorkspace } from "../workspace-context"

function useResourceActions(resource: Resource) {
  const { workspaceId } = useWorkspace()
  const updateResource = useUpdateResource(workspaceId)
  const deleteResource = useDeleteResource(workspaceId)
  const createResource = useCreateResource(workspaceId)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [newName, setNewName] = useState(resource.name)
  const [linkCopied, setLinkCopied] = useState(false)

  const handleRename = () => {
    if (newName.trim() && newName !== resource.name) {
      updateResource.mutate({ resourceId: resource.id, name: newName.trim() })
    }
    setRenameDialogOpen(false)
  }

  const handleDelete = () => {
    deleteResource.mutate(resource.id)
  }

  const handleCreateChild = (type: string, name: string) => {
    createResource.mutate({
      parentId: resource.id,
      name,
      resourceType: type as any,
    })
  }

  const handleCopyLink = () => {
    const url = `${window.location.origin}/w/${resource.workspaceId}/${resource.id}`
    navigator.clipboard.writeText(url)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 1500)
  }

  return {
    renameDialogOpen,
    setRenameDialogOpen,
    newName,
    setNewName,
    linkCopied,
    handleRename,
    handleDelete,
    handleCreateChild,
    handleCopyLink,
  }
}

function MenuItems({
  resource,
  onRename,
  onDelete,
  onCreateChild,
  onCopyLink,
  linkCopied,
}: {
  resource: Resource
  onRename: () => void
  onDelete: () => void
  onCreateChild: (type: string, name: string) => void
  onCopyLink: () => void
  linkCopied?: boolean
}) {
  return (
    <>
      <DropdownMenuItem onClick={onRename}>
        <Icon
          icon="icon-[ph--pencil-simple-duotone]"
          className="mr-2 h-4 w-4"
        />
        Rename
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onCopyLink}>
        <Icon
          icon={
            linkCopied ? "icon-[ph--check-duotone]" : "icon-[ph--copy-duotone]"
          }
          className="mr-2 h-4 w-4 transition-transform duration-150"
        />
        {linkCopied ? "Copied!" : "Copy Link"}
      </DropdownMenuItem>
      {resource.resourceType === "folder" && (
        <>
          <DropdownMenuSeparator />
          {CREATE_RESOURCE_TYPES.map((type) => {
            const config = RESOURCE_TYPE_CONFIG[type]
            return (
              <DropdownMenuItem
                key={type}
                onClick={() => onCreateChild(type, `New ${config.label}`)}
              >
                <Icon
                  icon={config.icon}
                  className="mr-2 h-4 w-4"
                  style={{ color: config.color }}
                />
                New {config.label}
              </DropdownMenuItem>
            )
          })}
        </>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={onDelete}
        className="text-destructive focus:text-destructive"
      >
        <Icon icon="icon-[ph--trash-duotone]" className="mr-2 h-4 w-4" />
        Delete
      </DropdownMenuItem>
    </>
  )
}

function RenameDialog({
  open,
  onOpenChange,
  name,
  onNameChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  onNameChange: (name: string) => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename</DialogTitle>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onConfirm()}
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Rename</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Context menu that opens at a specific position (not via Radix ContextMenuTrigger).
 * This avoids Radix Slot interfering with headless-tree's drag-and-drop handlers.
 */
export function TreeItemContextMenu({
  resource,
  position,
  onClose,
}: {
  resource: Resource
  position: { x: number; y: number } | null
  onClose: () => void
}) {
  const actions = useResourceActions(resource)
  const triggerRef = useRef<HTMLDivElement>(null)

  // When position changes, open the dropdown
  useEffect(() => {
    if (position && triggerRef.current) {
      triggerRef.current.style.position = "fixed"
      triggerRef.current.style.left = `${position.x}px`
      triggerRef.current.style.top = `${position.y}px`
      triggerRef.current.click()
    }
  }, [position])

  if (!position)
    return (
      <RenameDialog
        open={actions.renameDialogOpen}
        onOpenChange={actions.setRenameDialogOpen}
        name={actions.newName}
        onNameChange={actions.setNewName}
        onConfirm={actions.handleRename}
      />
    )

  return (
    <>
      <DropdownMenu
        open={!!position}
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
      >
        <DropdownMenuTrigger asChild>
          <div ref={triggerRef} className="pointer-events-none fixed h-0 w-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-48"
          style={{
            position: "fixed",
            left: position.x,
            top: position.y,
          }}
        >
          <MenuItems
            resource={resource}
            linkCopied={actions.linkCopied}
            onRename={() => {
              onClose()
              actions.setNewName(resource.name)
              actions.setRenameDialogOpen(true)
            }}
            onDelete={() => {
              onClose()
              actions.handleDelete()
            }}
            onCreateChild={(type, name) => {
              onClose()
              actions.handleCreateChild(type, name)
            }}
            onCopyLink={() => {
              onClose()
              actions.handleCopyLink()
            }}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameDialog
        open={actions.renameDialogOpen}
        onOpenChange={actions.setRenameDialogOpen}
        name={actions.newName}
        onNameChange={actions.setNewName}
        onConfirm={actions.handleRename}
      />
    </>
  )
}

export function TreeItemDropdownMenu({ resource }: { resource: Resource }) {
  const actions = useResourceActions(resource)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 transition-all duration-150 hover:bg-accent group-hover:opacity-100 data-[state=open]:opacity-100"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            draggable={false}
          >
            <Icon
              icon="icon-[ph--dots-three]"
              className="h-3.5 w-3.5 text-muted-foreground"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <MenuItems
            resource={resource}
            linkCopied={actions.linkCopied}
            onRename={() => {
              actions.setNewName(resource.name)
              actions.setRenameDialogOpen(true)
            }}
            onDelete={actions.handleDelete}
            onCreateChild={actions.handleCreateChild}
            onCopyLink={actions.handleCopyLink}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameDialog
        open={actions.renameDialogOpen}
        onOpenChange={actions.setRenameDialogOpen}
        name={actions.newName}
        onNameChange={actions.setNewName}
        onConfirm={actions.handleRename}
      />
    </>
  )
}
