import { generateSortKeyBetween } from "./sort-keys"

export interface ReorderItem {
  id: string
  parentId: string | null
  sortKey: string
}

export interface ReorderResult {
  resourceId: string
  newParentId: string | null
  sortKey: string
}

/**
 * Pure function: compute the new sortKey for an item being moved to a
 * specific insertion index within a parent's children.
 *
 * @param items        - All items (flat list, like React Query cache)
 * @param draggedId    - ID of the item being moved
 * @param newParentId  - Target parent (null = root)
 * @param insertionIndex - Position in the filtered sibling list (dragged item excluded).
 *                         0 = first, siblings.length = last.
 *                         If undefined, append at end.
 */
export function computeReorder(
  items: ReorderItem[],
  draggedId: string,
  newParentId: string | null,
  insertionIndex?: number
): ReorderResult {
  // Get siblings in target parent, excluding the dragged item, sorted by sortKey
  const siblings = items
    .filter(
      (r) =>
        r.id !== draggedId &&
        r.parentId === newParentId &&
        // note: in real usage we'd also filter out deleted items
        true
    )
    .sort((a, b) =>
      a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0
    )

  let afterKey: string | null = null
  let beforeKey: string | null = null

  if (insertionIndex !== undefined) {
    const insertAt = Math.max(0, Math.min(insertionIndex, siblings.length))
    afterKey = insertAt > 0 ? siblings[insertAt - 1].sortKey : null
    beforeKey = insertAt < siblings.length ? siblings[insertAt].sortKey : null
  } else {
    // Append at end
    afterKey =
      siblings.length > 0 ? siblings[siblings.length - 1].sortKey : null
    beforeKey = null
  }

  const sortKey = generateSortKeyBetween(afterKey, beforeKey)

  return { resourceId: draggedId, newParentId, sortKey }
}

/**
 * Apply a reorder result to a flat item list, returning a new list.
 * This is what the optimistic update does.
 */
export function applyReorder(
  items: ReorderItem[],
  result: ReorderResult
): ReorderItem[] {
  return items.map((r) => {
    if (r.id !== result.resourceId) return r
    return { ...r, parentId: result.newParentId, sortKey: result.sortKey }
  })
}

/**
 * Get the ordered IDs of children of a given parent, sorted by sortKey.
 */
export function getChildrenInOrder(
  items: ReorderItem[],
  parentId: string | null
): string[] {
  return items
    .filter((r) => r.parentId === parentId)
    .sort((a, b) =>
      a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0
    )
    .map((r) => r.id)
}
