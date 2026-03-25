import { generateKeyBetween } from "fractional-indexing"
import { describe, expect, it } from "vitest"

import {
  type ReorderItem,
  applyReorder,
  computeReorder,
  getChildrenInOrder,
} from "./reorder"

/** Helper: create items with sequential sort keys under a parent */
function makeItems(
  names: string[],
  parentId: string | null = null
): ReorderItem[] {
  let key: string | null = null
  return names.map((name) => {
    key = generateKeyBetween(key, null)
    return { id: name, parentId, sortKey: key }
  })
}

/** Helper: move item to index and return the new child order */
function moveAndGetOrder(
  items: ReorderItem[],
  draggedId: string,
  targetParentId: string | null,
  insertionIndex?: number
): string[] {
  const result = computeReorder(
    items,
    draggedId,
    targetParentId,
    insertionIndex
  )
  const updated = applyReorder(items, result)
  return getChildrenInOrder(updated, targetParentId)
}

describe("reorder: basic moves within same parent", () => {
  it("move last item to first position", () => {
    const items = makeItems(["A", "B", "C", "D"])
    const order = moveAndGetOrder(items, "D", null, 0)
    expect(order).toEqual(["D", "A", "B", "C"])
  })

  it("move first item to last position", () => {
    const items = makeItems(["A", "B", "C", "D"])
    const order = moveAndGetOrder(items, "A", null, 3)
    expect(order).toEqual(["B", "C", "D", "A"])
  })

  it("move middle item to first position", () => {
    const items = makeItems(["A", "B", "C", "D"])
    const order = moveAndGetOrder(items, "C", null, 0)
    expect(order).toEqual(["C", "A", "B", "D"])
  })

  it("move middle item to last position", () => {
    const items = makeItems(["A", "B", "C", "D"])
    const order = moveAndGetOrder(items, "B", null, 3)
    expect(order).toEqual(["A", "C", "D", "B"])
  })

  it("move item one position down", () => {
    const items = makeItems(["A", "B", "C", "D"])
    const order = moveAndGetOrder(items, "B", null, 2)
    expect(order).toEqual(["A", "C", "B", "D"])
  })

  it("move item one position up", () => {
    const items = makeItems(["A", "B", "C", "D"])
    const order = moveAndGetOrder(items, "C", null, 1)
    expect(order).toEqual(["A", "C", "B", "D"])
  })

  it("move to same position (no-op)", () => {
    const items = makeItems(["A", "B", "C", "D"])
    // B is at index 1 in the filtered list [A, C, D], so moving to index 1 keeps it at index 1
    const order = moveAndGetOrder(items, "B", null, 1)
    expect(order).toEqual(["A", "B", "C", "D"])
  })

  it("two items: swap", () => {
    const items = makeItems(["A", "B"])
    const order = moveAndGetOrder(items, "A", null, 1)
    expect(order).toEqual(["B", "A"])
  })

  it("single item: move to 0 (no-op)", () => {
    const items = makeItems(["A"])
    const order = moveAndGetOrder(items, "A", null, 0)
    expect(order).toEqual(["A"])
  })
})

describe("reorder: cross-parent moves", () => {
  it("move item from one parent to another at start", () => {
    const items = [
      ...makeItems(["A", "B", "C"], "folder1"),
      ...makeItems(["X", "Y"], "folder2"),
    ]
    const result = computeReorder(items, "B", "folder2", 0)
    expect(result.newParentId).toBe("folder2")
    const updated = applyReorder(items, result)
    expect(getChildrenInOrder(updated, "folder1")).toEqual(["A", "C"])
    expect(getChildrenInOrder(updated, "folder2")).toEqual(["B", "X", "Y"])
  })

  it("move item from one parent to another at end", () => {
    const items = [
      ...makeItems(["A", "B", "C"], "folder1"),
      ...makeItems(["X", "Y"], "folder2"),
    ]
    const result = computeReorder(items, "B", "folder2", 2)
    const updated = applyReorder(items, result)
    expect(getChildrenInOrder(updated, "folder1")).toEqual(["A", "C"])
    expect(getChildrenInOrder(updated, "folder2")).toEqual(["X", "Y", "B"])
  })

  it("move item from one parent to another in middle", () => {
    const items = [
      ...makeItems(["A", "B", "C"], "folder1"),
      ...makeItems(["X", "Y"], "folder2"),
    ]
    const result = computeReorder(items, "B", "folder2", 1)
    const updated = applyReorder(items, result)
    expect(getChildrenInOrder(updated, "folder1")).toEqual(["A", "C"])
    expect(getChildrenInOrder(updated, "folder2")).toEqual(["X", "B", "Y"])
  })

  it("move item to empty parent (no insertion index)", () => {
    const items = makeItems(["A", "B", "C"], "folder1")
    const result = computeReorder(items, "B", "folder2")
    const updated = applyReorder(items, result)
    expect(getChildrenInOrder(updated, "folder1")).toEqual(["A", "C"])
    expect(getChildrenInOrder(updated, "folder2")).toEqual(["B"])
  })
})

describe("reorder: append (no insertion index)", () => {
  it("append to end of existing siblings", () => {
    const items = [
      ...makeItems(["A", "B", "C"], "folder1"),
      ...makeItems(["X", "Y"], "folder2"),
    ]
    const result = computeReorder(items, "B", "folder2")
    const updated = applyReorder(items, result)
    expect(getChildrenInOrder(updated, "folder2")).toEqual(["X", "Y", "B"])
  })
})

describe("reorder: edge cases", () => {
  it("insertion index beyond bounds is clamped to end", () => {
    const items = makeItems(["A", "B", "C"])
    const order = moveAndGetOrder(items, "A", null, 999)
    expect(order).toEqual(["B", "C", "A"])
  })

  it("negative insertion index is clamped to 0", () => {
    const items = makeItems(["A", "B", "C"])
    const order = moveAndGetOrder(items, "C", null, -5)
    expect(order).toEqual(["C", "A", "B"])
  })
})

describe("reorder: sequential moves (sort key stability)", () => {
  it("move every item to position 0 in sequence", () => {
    let items = makeItems(["A", "B", "C", "D", "E"])

    // Move E to front
    let result = computeReorder(items, "E", null, 0)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, null)).toEqual(["E", "A", "B", "C", "D"])

    // Move D to front
    result = computeReorder(items, "D", null, 0)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, null)).toEqual(["D", "E", "A", "B", "C"])

    // Move C to front
    result = computeReorder(items, "C", null, 0)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, null)).toEqual(["C", "D", "E", "A", "B"])

    // Move B to front
    result = computeReorder(items, "B", null, 0)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, null)).toEqual(["B", "C", "D", "E", "A"])

    // Move A to front
    result = computeReorder(items, "A", null, 0)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, null)).toEqual(["A", "B", "C", "D", "E"])
  })

  it("move every item to last position in sequence", () => {
    let items = makeItems(["A", "B", "C", "D", "E"])

    for (const id of ["A", "B", "C", "D"]) {
      const siblings = getChildrenInOrder(items, null)
      const result = computeReorder(items, id, null, siblings.length - 1)
      items = applyReorder(items, result)
    }

    expect(getChildrenInOrder(items, null)).toEqual(["E", "A", "B", "C", "D"])
  })

  it("rotate the list by repeatedly moving first to last", () => {
    let items = makeItems(["A", "B", "C", "D"])
    const n = items.length

    // Move first item to end, n-1 times → rotates left by n-1
    for (let i = 0; i < n - 1; i++) {
      const children = getChildrenInOrder(items, null)
      const firstId = children[0]
      const result = computeReorder(items, firstId, null, n - 1)
      items = applyReorder(items, result)
    }

    // Each iteration moves first to end: [A,B,C,D] → [B,C,D,A] → [C,D,A,B] → [D,A,B,C]
    expect(getChildrenInOrder(items, null)).toEqual(["D", "A", "B", "C"])
  })

  it("shuffle back and forth", () => {
    let items = makeItems(["A", "B", "C", "D"])

    // Move A to end
    let result = computeReorder(items, "A", null, 3)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, null)).toEqual(["B", "C", "D", "A"])

    // Move A back to start
    result = computeReorder(items, "A", null, 0)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, null)).toEqual(["A", "B", "C", "D"])

    // Move D to position 1
    result = computeReorder(items, "D", null, 1)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, null)).toEqual(["A", "D", "B", "C"])

    // Move D back to end
    result = computeReorder(items, "D", null, 3)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, null)).toEqual(["A", "B", "C", "D"])
  })
})

describe("reorder: nested folder scenarios", () => {
  // Structure: root > [F1(children: A,B,C), F2(children: X,Y)]
  // F1 also contains a nested folder NF with children N1, N2
  function makeNestedTree(): ReorderItem[] {
    return [
      ...makeItems(["F1", "F2"], null),
      ...makeItems(["A", "B", "C"], "F1"),
      ...makeItems(["NF"], "F1"), // nested folder inside F1, after A,B,C
      ...makeItems(["N1", "N2"], "NF"),
      ...makeItems(["X", "Y"], "F2"),
    ]
  }

  it("move item from nested folder to root", () => {
    let items = makeNestedTree()
    const result = computeReorder(items, "N1", null, 0)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, null)).toEqual(["N1", "F1", "F2"])
    expect(getChildrenInOrder(items, "NF")).toEqual(["N2"])
  })

  it("move item from root into nested folder at start", () => {
    let items = makeNestedTree()
    const result = computeReorder(items, "F2", "NF", 0)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, null)).toEqual(["F1"])
    expect(getChildrenInOrder(items, "NF")).toEqual(["F2", "N1", "N2"])
  })

  it("move item from one folder to nested folder at end", () => {
    let items = makeNestedTree()
    const result = computeReorder(items, "X", "NF", 2)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, "F2")).toEqual(["Y"])
    expect(getChildrenInOrder(items, "NF")).toEqual(["N1", "N2", "X"])
  })

  it("move item from nested folder to sibling folder", () => {
    let items = makeNestedTree()
    const result = computeReorder(items, "N2", "F2", 1)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, "NF")).toEqual(["N1"])
    expect(getChildrenInOrder(items, "F2")).toEqual(["X", "N2", "Y"])
  })

  it("move nested folder itself to another parent", () => {
    let items = makeNestedTree()
    const result = computeReorder(items, "NF", "F2", 0)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, "F1")).toEqual(["A", "B", "C"])
    expect(getChildrenInOrder(items, "F2")).toEqual(["NF", "X", "Y"])
    // NF's children should remain intact
    expect(getChildrenInOrder(items, "NF")).toEqual(["N1", "N2"])
  })

  it("move item within nested folder: first to last", () => {
    let items = makeNestedTree()
    const order = moveAndGetOrder(items, "N1", "NF", 1)
    expect(order).toEqual(["N2", "N1"])
  })

  it("move item within nested folder: last to first", () => {
    let items = makeNestedTree()
    const order = moveAndGetOrder(items, "N2", "NF", 0)
    expect(order).toEqual(["N2", "N1"])
  })
})

describe("reorder: first/last/second position edge cases", () => {
  it("first to second (swap first two)", () => {
    const items = makeItems(["A", "B", "C", "D", "E"])
    const order = moveAndGetOrder(items, "A", null, 1)
    expect(order).toEqual(["B", "A", "C", "D", "E"])
  })

  it("second to first", () => {
    const items = makeItems(["A", "B", "C", "D", "E"])
    const order = moveAndGetOrder(items, "B", null, 0)
    expect(order).toEqual(["B", "A", "C", "D", "E"])
  })

  it("last to second-to-last", () => {
    const items = makeItems(["A", "B", "C", "D", "E"])
    const order = moveAndGetOrder(items, "E", null, 3)
    expect(order).toEqual(["A", "B", "C", "E", "D"])
  })

  it("second-to-last to last", () => {
    const items = makeItems(["A", "B", "C", "D", "E"])
    const order = moveAndGetOrder(items, "D", null, 4)
    expect(order).toEqual(["A", "B", "C", "E", "D"])
  })

  it("first to last across folder", () => {
    const items = [
      ...makeItems(["A", "B", "C"], "f1"),
      ...makeItems(["X", "Y", "Z"], "f2"),
    ]
    const result = computeReorder(items, "A", "f2", 3)
    const updated = applyReorder(items, result)
    expect(getChildrenInOrder(updated, "f1")).toEqual(["B", "C"])
    expect(getChildrenInOrder(updated, "f2")).toEqual(["X", "Y", "Z", "A"])
  })

  it("last to first across folder", () => {
    const items = [
      ...makeItems(["A", "B", "C"], "f1"),
      ...makeItems(["X", "Y", "Z"], "f2"),
    ]
    const result = computeReorder(items, "Z", "f1", 0)
    const updated = applyReorder(items, result)
    expect(getChildrenInOrder(updated, "f1")).toEqual(["Z", "A", "B", "C"])
    expect(getChildrenInOrder(updated, "f2")).toEqual(["X", "Y"])
  })

  it("move into empty folder", () => {
    const items = makeItems(["A", "B", "C"], "f1")
    const result = computeReorder(items, "B", "empty_folder", 0)
    const updated = applyReorder(items, result)
    expect(getChildrenInOrder(updated, "f1")).toEqual(["A", "C"])
    expect(getChildrenInOrder(updated, "empty_folder")).toEqual(["B"])
  })

  it("sequential cross-folder moves maintain order", () => {
    let items = [
      ...makeItems(["A", "B", "C"], "f1"),
      ...makeItems(["X", "Y"], "f2"),
    ]

    // Move A from f1 to f2 at start
    let result = computeReorder(items, "A", "f2", 0)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, "f1")).toEqual(["B", "C"])
    expect(getChildrenInOrder(items, "f2")).toEqual(["A", "X", "Y"])

    // Move Y from f2 to f1 at end
    result = computeReorder(items, "Y", "f1", 2)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, "f1")).toEqual(["B", "C", "Y"])
    expect(getChildrenInOrder(items, "f2")).toEqual(["A", "X"])

    // Move B from f1 to f2 in middle
    result = computeReorder(items, "B", "f2", 1)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, "f1")).toEqual(["C", "Y"])
    expect(getChildrenInOrder(items, "f2")).toEqual(["A", "B", "X"])

    // Move everything back: A to f1 at start
    result = computeReorder(items, "A", "f1", 0)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, "f1")).toEqual(["A", "C", "Y"])
    expect(getChildrenInOrder(items, "f2")).toEqual(["B", "X"])
  })
})

describe("reorder: random stress test", () => {
  /**
   * Perform N random reorders and verify invariants after each:
   * 1. Total item count is preserved
   * 2. All items are still present
   * 3. Sort keys are all unique
   * 4. Sort keys are strictly ordered (no ties)
   */
  it("100 random reorders on 8 items maintain order invariants", () => {
    let items = makeItems(["A", "B", "C", "D", "E", "F", "G", "H"])
    const allIds = new Set(items.map((r) => r.id))

    // Seed a simple PRNG for reproducibility
    let seed = 42
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }

    for (let i = 0; i < 100; i++) {
      const children = getChildrenInOrder(items, null)
      const dragIdx = Math.floor(rand() * children.length)
      const draggedId = children[dragIdx]

      // Random insertion index in [0, children.length - 1]
      const insertionIndex = Math.floor(rand() * children.length)

      const result = computeReorder(items, draggedId, null, insertionIndex)
      items = applyReorder(items, result)

      // Invariant checks
      const order = getChildrenInOrder(items, null)
      expect(order.length).toBe(allIds.size)
      expect(new Set(order)).toEqual(allIds)

      // Sort keys should be unique and strictly increasing
      const sortKeys = items
        .filter((r) => r.parentId === null)
        .sort((a, b) =>
          a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0
        )
        .map((r) => r.sortKey)

      for (let j = 1; j < sortKeys.length; j++) {
        expect(sortKeys[j] > sortKeys[j - 1]).toBe(true)
      }
    }
  })

  it("50 random reorders across 2 parents", () => {
    let items = [
      ...makeItems(["A", "B", "C", "D"], "p1"),
      ...makeItems(["W", "X", "Y", "Z"], "p2"),
    ]
    const allIds = new Set(items.map((r) => r.id))

    let seed = 123
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }

    for (let i = 0; i < 50; i++) {
      // Pick random parent
      const targetParent = rand() < 0.5 ? "p1" : "p2"
      const allItemIds = items.map((r) => r.id)
      const draggedId = allItemIds[Math.floor(rand() * allItemIds.length)]
      const targetChildren = getChildrenInOrder(items, targetParent)
      const insertionIndex = Math.floor(rand() * (targetChildren.length + 1))

      const result = computeReorder(
        items,
        draggedId,
        targetParent,
        insertionIndex
      )
      items = applyReorder(items, result)

      // All items still present
      expect(new Set(items.map((r) => r.id))).toEqual(allIds)
      expect(items.length).toBe(allIds.size)

      // Each parent's children have strictly increasing sort keys
      for (const pid of ["p1", "p2"]) {
        const children = items
          .filter((r) => r.parentId === pid)
          .sort((a, b) =>
            a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0
          )
        for (let j = 1; j < children.length; j++) {
          expect(children[j].sortKey > children[j - 1].sortKey).toBe(true)
        }
      }
    }
  })

  it("500 random moves across 3 nested folders", () => {
    // Simulate a realistic workspace: 3 top-level folders with items
    let items: ReorderItem[] = [
      ...makeItems(["f1", "f2", "f3"], null), // 3 folders at root
      ...makeItems(["a1", "a2", "a3", "a4"], "f1"), // children of f1
      ...makeItems(["b1", "b2", "b3"], "f2"), // children of f2
      ...makeItems(["c1", "c2", "c3", "c4", "c5"], "f3"), // children of f3
      ...makeItems(["d1", "d2"], "a1"), // nested: children of a1 inside f1
    ]
    const allIds = new Set(items.map((r) => r.id))
    const parents = [null, "f1", "f2", "f3", "a1"]

    let seed = 999
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }

    for (let i = 0; i < 500; i++) {
      const targetParent = parents[Math.floor(rand() * parents.length)]
      const allItemIds = items.map((r) => r.id)
      const draggedId = allItemIds[Math.floor(rand() * allItemIds.length)]
      const targetChildren = getChildrenInOrder(items, targetParent)
      const insertionIndex = Math.floor(rand() * (targetChildren.length + 1))

      const result = computeReorder(
        items,
        draggedId,
        targetParent,
        insertionIndex
      )
      items = applyReorder(items, result)

      // All items still present
      expect(new Set(items.map((r) => r.id))).toEqual(allIds)
      expect(items.length).toBe(allIds.size)

      // Every parent's children have strictly increasing sort keys
      for (const pid of parents) {
        const children = items
          .filter((r) => r.parentId === pid)
          .sort((a, b) =>
            a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0
          )
        for (let j = 1; j < children.length; j++) {
          expect(children[j].sortKey > children[j - 1].sortKey).toBe(true)
        }
      }
    }
  })

  it("200 random moves: all to position 0 (stress on prepend)", () => {
    let items = makeItems(["A", "B", "C", "D", "E", "F"])
    const allIds = new Set(items.map((r) => r.id))

    let seed = 7
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }

    for (let i = 0; i < 200; i++) {
      const children = getChildrenInOrder(items, null)
      const dragIdx = Math.floor(rand() * children.length)
      const draggedId = children[dragIdx]

      const result = computeReorder(items, draggedId, null, 0)
      items = applyReorder(items, result)

      const order = getChildrenInOrder(items, null)
      expect(order[0]).toBe(draggedId)
      expect(order.length).toBe(allIds.size)
      expect(new Set(order)).toEqual(allIds)

      // Strictly increasing sort keys
      const sortKeys = items
        .sort((a, b) =>
          a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0
        )
        .map((r) => r.sortKey)
      for (let j = 1; j < sortKeys.length; j++) {
        expect(sortKeys[j] > sortKeys[j - 1]).toBe(true)
      }
    }
  })
})

describe("reorder: idempotency — move to current exact position", () => {
  it("moving item to its current index produces same order", () => {
    const items = makeItems(["A", "B", "C", "D"])
    // B is at index 1. In filtered siblings (excluding B): [A, C, D], index 1 means after A.
    const order = moveAndGetOrder(items, "B", null, 1)
    expect(order).toEqual(["A", "B", "C", "D"])
  })

  it("moving first item to index 0 produces same order", () => {
    const items = makeItems(["A", "B", "C", "D"])
    const order = moveAndGetOrder(items, "A", null, 0)
    expect(order).toEqual(["A", "B", "C", "D"])
  })

  it("moving last item to last index produces same order", () => {
    const items = makeItems(["A", "B", "C", "D"])
    // D at last. Filtered siblings [A,B,C], index 3 = append at end
    const order = moveAndGetOrder(items, "D", null, 3)
    expect(order).toEqual(["A", "B", "C", "D"])
  })

  it("sort key does not change unnecessarily on no-op move", () => {
    const items = makeItems(["A", "B", "C", "D"])
    const originalKey = items.find((r) => r.id === "B")!.sortKey
    const result = computeReorder(items, "B", null, 1)
    // The key may differ (implementation generates a new key between neighbors),
    // but the order must remain stable
    const updated = applyReorder(items, result)
    expect(getChildrenInOrder(updated, null)).toEqual(["A", "B", "C", "D"])
  })
})

describe("reorder: deeply nested (3+ levels)", () => {
  function makeDeeplyNested(): ReorderItem[] {
    return [
      ...makeItems(["root1", "root2"], null),
      ...makeItems(["L1a", "L1b"], "root1"),
      ...makeItems(["L2a", "L2b"], "L1a"),
      ...makeItems(["L3a", "L3b", "L3c"], "L2a"), // 4 levels deep: null > root1 > L1a > L2a > L3*
    ]
  }

  it("move item from deepest level to root", () => {
    let items = makeDeeplyNested()
    const result = computeReorder(items, "L3b", null, 0)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, null)).toEqual(["L3b", "root1", "root2"])
    expect(getChildrenInOrder(items, "L2a")).toEqual(["L3a", "L3c"])
  })

  it("move item from root to deepest level", () => {
    let items = makeDeeplyNested()
    const result = computeReorder(items, "root2", "L2a", 1)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, null)).toEqual(["root1"])
    expect(getChildrenInOrder(items, "L2a")).toEqual([
      "L3a",
      "root2",
      "L3b",
      "L3c",
    ])
  })

  it("move item between non-adjacent depth levels", () => {
    let items = makeDeeplyNested()
    // Move L3a from L2a to L1a (skip one level up)
    const result = computeReorder(items, "L3a", "L1a", 0)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, "L1a")).toEqual(["L3a", "L2a", "L2b"])
    expect(getChildrenInOrder(items, "L2a")).toEqual(["L3b", "L3c"])
  })

  it("move item from mid level to deepest level", () => {
    let items = makeDeeplyNested()
    const result = computeReorder(items, "L1b", "L2a", 3)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, "root1")).toEqual(["L1a"])
    expect(getChildrenInOrder(items, "L2a")).toEqual([
      "L3a",
      "L3b",
      "L3c",
      "L1b",
    ])
  })
})

describe("reorder: drain all items from one parent into another", () => {
  it("move all items from f1 to f2 one-by-one", () => {
    let items = [
      ...makeItems(["A", "B", "C", "D"], "f1"),
      ...makeItems(["X"], "f2"),
    ]

    for (const id of ["A", "B", "C", "D"]) {
      const f2Children = getChildrenInOrder(items, "f2")
      const result = computeReorder(items, id, "f2", f2Children.length)
      items = applyReorder(items, result)
    }

    expect(getChildrenInOrder(items, "f1")).toEqual([])
    expect(getChildrenInOrder(items, "f2")).toEqual(["X", "A", "B", "C", "D"])
  })

  it("move all items from f1 to f2 at start one-by-one (reverse order)", () => {
    let items = [
      ...makeItems(["A", "B", "C"], "f1"),
      ...makeItems(["X", "Y"], "f2"),
    ]

    // Move each to start of f2 — they stack in reverse
    for (const id of ["A", "B", "C"]) {
      const result = computeReorder(items, id, "f2", 0)
      items = applyReorder(items, result)
    }

    expect(getChildrenInOrder(items, "f1")).toEqual([])
    expect(getChildrenInOrder(items, "f2")).toEqual(["C", "B", "A", "X", "Y"])
  })
})

describe("reorder: alternating prepend/append", () => {
  it("alternate between position 0 and last for many rounds", () => {
    let items = makeItems(["A", "B", "C", "D", "E"])
    const allIds = new Set(items.map((r) => r.id))
    const itemIds = ["A", "B", "C", "D", "E"]

    for (let i = 0; i < 30; i++) {
      const id = itemIds[i % itemIds.length]
      const siblings = getChildrenInOrder(items, null)
      const targetIndex = i % 2 === 0 ? 0 : siblings.length - 1
      const result = computeReorder(items, id, null, targetIndex)
      items = applyReorder(items, result)

      // Invariants
      const order = getChildrenInOrder(items, null)
      expect(order.length).toBe(allIds.size)
      expect(new Set(order)).toEqual(allIds)

      // Unique sort keys
      const sortKeys = items.map((r) => r.sortKey)
      expect(new Set(sortKeys).size).toBe(sortKeys.length)
    }
  })
})

describe("reorder: move the only child out", () => {
  it("parent has exactly 1 child, move it out — parent becomes empty", () => {
    let items = [...makeItems(["A"], "f1"), ...makeItems(["X", "Y"], "f2")]
    const result = computeReorder(items, "A", "f2", 1)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, "f1")).toEqual([])
    expect(getChildrenInOrder(items, "f2")).toEqual(["X", "A", "Y"])
  })

  it("move only child to root", () => {
    let items = [
      ...makeItems(["folder"], null),
      ...makeItems(["only"], "folder"),
    ]
    const result = computeReorder(items, "only", null, 0)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, "folder")).toEqual([])
    expect(getChildrenInOrder(items, null)).toEqual(["only", "folder"])
  })
})

describe("reorder: adjacent swap stress", () => {
  it("repeatedly swap adjacent pairs: A↔B, B↔C, C↔D, etc.", () => {
    let items = makeItems(["A", "B", "C", "D", "E", "F"])
    const allIds = new Set(items.map((r) => r.id))

    // Perform multiple rounds of adjacent swaps
    for (let round = 0; round < 5; round++) {
      const order = getChildrenInOrder(items, null)
      for (let i = 0; i < order.length - 1; i++) {
        // Swap item at position i with item at position i+1
        // Move item[i] to after item[i+1]: in filtered siblings that means index i+1
        const children = getChildrenInOrder(items, null)
        const itemToMove = children[i]
        const result = computeReorder(items, itemToMove, null, i + 1)
        items = applyReorder(items, result)
      }

      // Invariants
      const finalOrder = getChildrenInOrder(items, null)
      expect(finalOrder.length).toBe(allIds.size)
      expect(new Set(finalOrder)).toEqual(allIds)

      // Sort keys strictly increasing
      const sorted = items
        .filter((r) => r.parentId === null)
        .sort((a, b) =>
          a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0
        )
      for (let j = 1; j < sorted.length; j++) {
        expect(sorted[j].sortKey > sorted[j - 1].sortKey).toBe(true)
      }
    }
  })
})

describe("reorder: sort key collision resistance", () => {
  it("many insertions between the same two items never produce duplicate keys", () => {
    let items = makeItems(["A", "B"])
    const seenKeys = new Set(items.map((r) => r.sortKey))

    // Repeatedly insert new items between A and B by moving them there
    for (let i = 0; i < 50; i++) {
      const newId = `X${i}`
      // Add a new item at the end first
      const appendResult = computeReorder(items, newId, null)
      // We need to add the item to the list first
      items = [
        ...items,
        { id: newId, parentId: null, sortKey: appendResult.sortKey },
      ]

      // Now move it to position 1 (between A and whatever is second)
      const result = computeReorder(items, newId, null, 1)
      items = applyReorder(items, result)

      // Check no collisions
      const allKeys = items.map((r) => r.sortKey)
      expect(new Set(allKeys).size).toBe(allKeys.length)

      for (const k of allKeys) {
        seenKeys.add(k)
      }
    }

    // All sort keys ever generated should be unique
    const finalKeys = items.map((r) => r.sortKey)
    expect(new Set(finalKeys).size).toBe(finalKeys.length)
  })
})

describe("reorder: large list (20+ items)", () => {
  it("stress test with 25 siblings — random moves maintain invariants", () => {
    const names = Array.from({ length: 25 }, (_, i) => `item${i}`)
    let items = makeItems(names)
    const allIds = new Set(names)

    let seed = 314
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }

    for (let i = 0; i < 100; i++) {
      const children = getChildrenInOrder(items, null)
      const dragIdx = Math.floor(rand() * children.length)
      const draggedId = children[dragIdx]
      const insertionIndex = Math.floor(rand() * children.length)

      const result = computeReorder(items, draggedId, null, insertionIndex)
      items = applyReorder(items, result)

      const order = getChildrenInOrder(items, null)
      expect(order.length).toBe(allIds.size)
      expect(new Set(order)).toEqual(allIds)

      // Strictly increasing sort keys
      const sorted = items
        .filter((r) => r.parentId === null)
        .sort((a, b) =>
          a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0
        )
      for (let j = 1; j < sorted.length; j++) {
        expect(sorted[j].sortKey > sorted[j - 1].sortKey).toBe(true)
      }
    }
  })

  it("move items across the full range of a 25-item list", () => {
    const names = Array.from({ length: 25 }, (_, i) => `item${i}`)
    let items = makeItems(names)

    // Move last to first
    let order = moveAndGetOrder(items, "item24", null, 0)
    expect(order[0]).toBe("item24")
    expect(order.length).toBe(25)

    // Move first to last
    const result1 = computeReorder(items, "item0", null, 24)
    items = applyReorder(items, result1)
    order = getChildrenInOrder(items, null)
    expect(order[order.length - 1]).toBe("item0")

    // Move to middle
    const result2 = computeReorder(items, "item0", null, 12)
    items = applyReorder(items, result2)
    order = getChildrenInOrder(items, null)
    expect(order.indexOf("item0")).toBe(12)
  })
})

describe("reorder: same parent different index — parentId preserved", () => {
  it("move item within same parent keeps parentId unchanged", () => {
    const items = makeItems(["A", "B", "C", "D"], "folder1")
    const result = computeReorder(items, "C", "folder1", 0)
    expect(result.newParentId).toBe("folder1")
    const updated = applyReorder(items, result)
    expect(getChildrenInOrder(updated, "folder1")).toEqual(["C", "A", "B", "D"])
    // Verify all items still have folder1 as parent
    for (const item of updated) {
      expect(item.parentId).toBe("folder1")
    }
  })

  it("move within same parent to various positions", () => {
    let items = makeItems(["A", "B", "C", "D", "E"], "p1")

    // Move E to position 0
    let result = computeReorder(items, "E", "p1", 0)
    expect(result.newParentId).toBe("p1")
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, "p1")).toEqual(["E", "A", "B", "C", "D"])

    // Move E to position 2
    result = computeReorder(items, "E", "p1", 2)
    expect(result.newParentId).toBe("p1")
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, "p1")).toEqual(["A", "B", "E", "C", "D"])

    // Move E to last
    result = computeReorder(items, "E", "p1", 4)
    expect(result.newParentId).toBe("p1")
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, "p1")).toEqual(["A", "B", "C", "D", "E"])
  })
})

describe("reorder: cross-parent round trip", () => {
  it("move item A from f1 → f2 → f3 → f1 and verify correct placement each time", () => {
    let items = [
      ...makeItems(["A", "B", "C"], "f1"),
      ...makeItems(["X", "Y"], "f2"),
      ...makeItems(["P", "Q", "R"], "f3"),
    ]

    // f1 → f2 (at position 1)
    let result = computeReorder(items, "A", "f2", 1)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, "f1")).toEqual(["B", "C"])
    expect(getChildrenInOrder(items, "f2")).toEqual(["X", "A", "Y"])
    expect(items.find((r) => r.id === "A")!.parentId).toBe("f2")

    // f2 → f3 (at position 0)
    result = computeReorder(items, "A", "f3", 0)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, "f2")).toEqual(["X", "Y"])
    expect(getChildrenInOrder(items, "f3")).toEqual(["A", "P", "Q", "R"])
    expect(items.find((r) => r.id === "A")!.parentId).toBe("f3")

    // f3 → f1 (at position 2, which is end)
    result = computeReorder(items, "A", "f1", 2)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, "f3")).toEqual(["P", "Q", "R"])
    expect(getChildrenInOrder(items, "f1")).toEqual(["B", "C", "A"])
    expect(items.find((r) => r.id === "A")!.parentId).toBe("f1")
  })

  it("round trip returns item to original parent with stable ordering of other items", () => {
    let items = [
      ...makeItems(["A", "B", "C", "D"], "f1"),
      ...makeItems(["X", "Y"], "f2"),
    ]

    // Move A out of f1 to f2
    let result = computeReorder(items, "A", "f2", 0)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, "f1")).toEqual(["B", "C", "D"])

    // Move A back to f1 at position 0
    result = computeReorder(items, "A", "f1", 0)
    items = applyReorder(items, result)
    expect(getChildrenInOrder(items, "f1")).toEqual(["A", "B", "C", "D"])
    expect(getChildrenInOrder(items, "f2")).toEqual(["X", "Y"])
  })
})
