import type { ItemInstance } from "@headless-tree/core"
import { useState } from "react"

import { Icon } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"

import { RESOURCE_TYPE_CONFIG } from "../../constants/resource-config"
import type { Resource } from "../../types"
import { TreeItemContextMenu, TreeItemDropdownMenu } from "./tree-context-menu"

function HighlightedName({ name, query }: { name: string; query: string }) {
  if (!query) return <>{name}</>
  const idx = name.toLowerCase().indexOf(query)
  if (idx === -1) return <>{name}</>
  return (
    <>
      {name.slice(0, idx)}
      <mark className="bg-amber-200/70 dark:bg-amber-500/30 text-inherit rounded-sm px-0.5">
        {name.slice(idx, idx + query.length)}
      </mark>
      {name.slice(idx + query.length)}
    </>
  )
}

export function TreeItem({
  item,
  selectedResourceId,
  onSelect,
  searchQuery = "",
}: {
  item: ItemInstance<Resource>
  selectedResourceId?: string
  onSelect: (id: string) => void
  searchQuery?: string
}) {
  "use no memo"
  const data = item.getItemData()
  const config = RESOURCE_TYPE_CONFIG[data.resourceType]
  const isFolder = data.resourceType === "folder"
  const isSelected = data.id === selectedResourceId
  const level = item.getItemMeta().level
  const isDragTarget = item.isDragTarget()
  const isTopLevel = level === 1

  // Context menu state managed manually to avoid Radix Slot interfering with DnD
  const [contextMenuPos, setContextMenuPos] = useState<{
    x: number
    y: number
  } | null>(null)

  return (
    <>
      <button
        {...item.getProps()}
        onClick={() => {
          onSelect(data.id)
          if (isFolder) {
            item.isExpanded() ? item.collapse() : item.expand()
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setContextMenuPos({ x: e.clientX, y: e.clientY })
        }}
        style={{ paddingLeft: `${level * 16}px` }}
        className={cn("w-full text-left outline-none", isTopLevel && "mt-0.5")}
      >
        <div
          className={cn(
            "group relative mx-1 flex cursor-pointer items-center gap-1.5 rounded-md px-2 text-sm",
            "transition-[background-color,color,box-shadow] duration-150",
            // Arrange: folders get more visual weight at top level
            isFolder && isTopLevel ? "py-1.5 font-medium" : "py-1",
            // Hover
            "hover:bg-accent/60",
            // Focus-visible: clean ring for keyboard navigation
            "focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1",
            // Selected: left accent bar + subtle fill
            isSelected && [
              "bg-accent text-accent-foreground",
              "before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:rounded-full before:bg-primary",
              "before:animate-in before:fade-in before:slide-in-from-left-1 before:duration-200",
            ],
            // Drag target: unified with accent palette
            isDragTarget && "bg-primary/10 ring-1 ring-primary/40 rounded-md",
            // Arrange: deeper items get slightly muted
            level > 2 && !isSelected && "text-muted-foreground/90"
          )}
        >
          {isFolder ? (
            <span
              className="flex h-4 w-4 shrink-0 items-center justify-center"
              onClick={(e) => {
                e.stopPropagation()
                item.isExpanded() ? item.collapse() : item.expand()
              }}
            >
              <Icon
                icon="icon-[ph--caret-right]"
                className={cn(
                  "h-3 w-3 text-muted-foreground transition-transform duration-200",
                  item.isExpanded() && "rotate-90"
                )}
              />
            </span>
          ) : (
            <span className="h-4 w-4 shrink-0" />
          )}
          <Icon
            icon={config.icon}
            className={cn(
              "h-4 w-4 shrink-0 transition-transform duration-200",
              "group-hover:scale-110"
            )}
            style={{ color: config.color }}
          />
          <span className="min-w-0 flex-1 truncate">
            <HighlightedName name={data.name} query={searchQuery} />
          </span>
          <TreeItemDropdownMenu resource={data} />
        </div>
      </button>

      <TreeItemContextMenu
        resource={data}
        position={contextMenuPos}
        onClose={() => setContextMenuPos(null)}
      />
    </>
  )
}
