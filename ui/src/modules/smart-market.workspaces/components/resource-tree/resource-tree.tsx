import {
  type DragTarget,
  type ItemInstance,
  dragAndDropFeature,
  hotkeysCoreFeature,
  searchFeature,
  selectionFeature,
  syncDataLoaderFeature,
} from "@headless-tree/core"
import { useTree } from "@headless-tree/react"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useParams } from "react-router"

import { useApp } from "@rio.js/app-ui/hooks/use-app"
import { Icon } from "@rio.js/ui/icon"

import { useMoveResource } from "../../data/use-move-resource"
import type { Resource } from "../../types"
import { compareSortKeys } from "../../utils/sort-keys"
import { useWorkspace } from "../workspace-context"
import { TreeItem } from "./tree-item"

interface TreeDataMap {
  [itemId: string]: Resource & { childrenIds: string[] }
}

function buildDataMap(resources: Resource[]): TreeDataMap {
  const map: TreeDataMap = {}

  // Create a virtual root
  map["root"] = {
    id: "root",
    workspaceId: "",
    parentId: null,
    name: "Root",
    resourceType: "folder",
    sortKey: "",
    createdBy: "",
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    deletedBy: null,
    childrenIds: [],
  }

  // Initialize all items
  for (const r of resources) {
    map[r.id] = { ...r, childrenIds: [] }
  }

  // Build parent-child relationships
  for (const r of resources) {
    const parentId = r.parentId ?? "root"
    if (map[parentId]) {
      map[parentId].childrenIds.push(r.id)
    } else {
      map["root"].childrenIds.push(r.id)
    }
  }

  // Sort children by sortKey so tree order matches
  for (const entry of Object.values(map)) {
    entry.childrenIds.sort((a, b) =>
      compareSortKeys(map[a]?.sortKey ?? "", map[b]?.sortKey ?? "")
    )
  }

  return map
}

function isOrderedTarget<T>(
  target: DragTarget<T>
): target is DragTarget<T> & { childIndex: number; insertionIndex: number } {
  return "childIndex" in target
}

const ITEM_HEIGHT = 32

export function ResourceTree({ searchQuery = "" }: { searchQuery?: string }) {
  "use no memo"
  const { resources } = useWorkspace()
  const { workspaceId, resourceId } = useParams<{
    workspaceId: string
    resourceId: string
  }>()
  const app = useApp()
  const moveResource = useMoveResource(workspaceId!)
  const scrollRef = useRef<HTMLDivElement>(null)

  const dataMap = useMemo(() => buildDataMap(resources), [resources])
  const dataMapRef = useRef(dataMap)
  dataMapRef.current = dataMap

  const handleDrop = useCallback(
    async (items: ItemInstance<Resource>[], target: DragTarget<Resource>) => {
      const currentMap = dataMapRef.current
      for (const draggedItem of items) {
        const draggedData = draggedItem.getItemData()
        const targetParent = target.item.getItemData()
        const newParentId = targetParent.id === "root" ? null : targetParent.id

        // Prevent dropping a folder into itself or its descendants
        if (draggedData.resourceType === "folder") {
          let checkId = newParentId
          while (checkId) {
            if (checkId === draggedData.id) return
            const parent = currentMap[checkId]
            checkId = parent?.parentId ?? null
          }
        }

        if (isOrderedTarget(target)) {
          // Get the full sorted children of the target parent (excluding the dragged item)
          const targetParentId =
            targetParent.id === "root" ? "root" : targetParent.id
          const siblingIds = currentMap[targetParentId]?.childrenIds ?? []
          const siblings = siblingIds
            .map((id) => currentMap[id])
            .filter((r) => r && r.id !== draggedData.id)
            .sort((a, b) => compareSortKeys(a.sortKey, b.sortKey))

          // insertionIndex is the position in the filtered list (with dragged item removed)
          // childIndex is in the original list — using it with filtered list causes off-by-one
          const insertAt = Math.min(target.insertionIndex, siblings.length)

          // Neighbor sort keys for fractional indexing
          const afterKey =
            insertAt > 0 ? (siblings[insertAt - 1]?.sortKey ?? null) : null
          const beforeKey =
            insertAt < siblings.length
              ? (siblings[insertAt]?.sortKey ?? null)
              : null

          moveResource.mutate({
            resourceId: draggedData.id,
            newParentId,
            afterSortKey: afterKey,
            beforeSortKey: beforeKey,
          })
        } else {
          // Drop into folder (unordered) — append at end
          moveResource.mutate({
            resourceId: draggedData.id,
            newParentId,
          })
        }
      }
    },
    [moveResource]
  )

  const handleSelect = useCallback(
    (id: string) => {
      if (id === "root") return
      startTransition(() => {
        app.navigate(`/w/${workspaceId}/files/${id}`)
      })
    },
    [app.navigate, workspaceId]
  )

  // Track focused item to scroll virtualizer when keyboard-navigating
  const [focusedItem, setFocusedItem] = useState<string | null>(null)
  const virtualizerRef = useRef<ReturnType<typeof useVirtualizer> | null>(null)
  const itemsRef = useRef<ItemInstance<Resource>[]>([])

  const tree = useTree<Resource>({
    rootItemId: "root",
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData().resourceType === "folder",
    canReorder: true,
    indent: 16,
    state: { focusedItem },
    setFocusedItem: (setter) => {
      setFocusedItem((prev) => {
        const next = typeof setter === "function" ? setter(prev) : setter
        // Scroll virtualizer to the focused item so its DOM element exists
        // before headless-tree tries to call .focus() on it
        if (next) {
          const idx = itemsRef.current.findIndex((i) => i.getId() === next)
          if (idx >= 0) {
            virtualizerRef.current?.scrollToIndex(idx, { align: "auto" })
          }
        }
        return next
      })
    },
    dataLoader: {
      getItem: (itemId) => dataMap[itemId],
      getChildren: (itemId) => dataMap[itemId]?.childrenIds ?? [],
    },
    onDrop: handleDrop,
    canDrop: (items, target) => {
      if (isOrderedTarget(target)) return true
      return (
        target.item.getItemData().resourceType === "folder" ||
        target.item.getId() === "root"
      )
    },
    features: [
      syncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      searchFeature,
      dragAndDropFeature,
    ],
  })

  // Rebuild tree when data changes (optimistic updates, refetches)
  const prevDataMapRef = useRef(dataMap)
  useEffect(() => {
    if (prevDataMapRef.current !== dataMap) {
      prevDataMapRef.current = dataMap
      tree.rebuildTree()
    }
  }, [dataMap, tree])

  // When searching, expand all ancestors of matching items
  const search = searchQuery.trim().toLowerCase()
  const matchingIds = useMemo(() => {
    if (!search) return null
    const matches = new Set<string>()
    for (const r of resources) {
      if (r.name.toLowerCase().includes(search)) {
        matches.add(r.id)
        // Also include all ancestors so the path is visible
        let pid = r.parentId
        while (pid && dataMap[pid]) {
          matches.add(pid)
          pid = dataMap[pid].parentId
        }
      }
    }
    return matches
  }, [search, resources, dataMap])

  // Auto-expand folders that contain matches
  useEffect(() => {
    if (!matchingIds) return
    for (const item of tree.getItems()) {
      const id = item.getId()
      if (matchingIds.has(id) && item.isFolder() && !item.isExpanded()) {
        item.expand()
      }
    }
  }, [matchingIds, tree])

  const allItems = tree.getItems()
  const items = matchingIds
    ? allItems.filter((item) => matchingIds.has(item.getId()))
    : allItems
  itemsRef.current = items

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ITEM_HEIGHT,
    overscan: 20,
  })
  virtualizerRef.current = virtualizer

  if (items.length === 0) {
    return search ? (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center animate-in fade-in duration-200">
        <Icon
          icon="icon-[ph--magnifying-glass-duotone]"
          className="h-8 w-8 text-muted-foreground/50"
        />
        <p className="text-xs text-muted-foreground">
          No results for &ldquo;{searchQuery}&rdquo;
        </p>
        <p className="text-[11px] text-muted-foreground/60">
          Try a different search term
        </p>
      </div>
    ) : (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/60">
          <Icon
            icon="icon-[ph--tree-structure-duotone]"
            className="h-6 w-6 text-muted-foreground"
          />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            Start building your workspace
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Add datasets, maps, reports, and more.
            <br />
            Use the <span className="font-medium">+</span> button above to
            create your first resource.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="relative h-full overflow-auto">
      <div
        className="relative py-1"
        {...tree.getContainerProps()}
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index]
          return (
            <div
              key={item.getId()}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <TreeItem
                item={item}
                selectedResourceId={resourceId}
                onSelect={handleSelect}
                searchQuery={search}
              />
            </div>
          )
        })}
        <div style={tree.getDragLineStyle()} className="dragline" />
      </div>
    </div>
  )
}
