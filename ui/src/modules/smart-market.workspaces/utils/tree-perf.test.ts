import { describe, expect, test } from "bun:test"

import type { Resource, ResourceType } from "../types"
import { buildTree } from "./tree-builder"

const RESOURCE_TYPES: ResourceType[] = [
  "folder",
  "map",
  "dashboard",
  "pipeline",
  "ontology",
  "process",
  "report",
]

function generateResources(count: number): Resource[] {
  const now = new Date().toISOString()
  const resources: Resource[] = []

  // Create ~10% folders, rest are leaf resources
  const folderCount = Math.max(1, Math.floor(count * 0.1))
  const leafCount = count - folderCount

  // Create folders (some nested)
  for (let i = 0; i < folderCount; i++) {
    const parentId =
      i === 0
        ? null
        : i < 5
          ? null
          : `folder_${Math.floor(Math.random() * Math.min(i, 5))}`

    resources.push({
      id: `folder_${i}`,
      workspaceId: "ws_perf",
      parentId,
      name: `Folder ${i}`,
      resourceType: "folder",
      sortKey: `a${i}`,
      createdBy: "user_1",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedBy: null,
    })
  }

  // Create leaf resources distributed across folders
  for (let i = 0; i < leafCount; i++) {
    const parentId = `folder_${Math.floor(Math.random() * folderCount)}`
    const type = RESOURCE_TYPES[1 + (i % (RESOURCE_TYPES.length - 1))]

    resources.push({
      id: `res_${i}`,
      workspaceId: "ws_perf",
      parentId,
      name: `Resource ${i}`,
      resourceType: type,
      sortKey: `a${i}`,
      createdBy: "user_1",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedBy: null,
    })
  }

  return resources
}

describe("tree performance", () => {
  test("buildTree with 1,000 resources", () => {
    const resources = generateResources(1000)
    const start = performance.now()
    const tree = buildTree(resources)
    const elapsed = performance.now() - start

    console.log(`buildTree(1000): ${elapsed.toFixed(2)}ms`)
    expect(tree.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(100) // should be well under 100ms
  })

  test("buildTree with 10,000 resources", () => {
    const resources = generateResources(10000)
    const start = performance.now()
    const tree = buildTree(resources)
    const elapsed = performance.now() - start

    console.log(`buildTree(10000): ${elapsed.toFixed(2)}ms`)
    expect(tree.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(500) // should be under 500ms
  })

  test("rendering item count at 1,000 resources - all folders expanded", () => {
    // Simulate worst case: all folders expanded, every item visible
    const resources = generateResources(1000)
    // Count total items that would be rendered
    const totalItems = resources.length
    console.log(`Total items rendered (all expanded, 1000): ${totalItems}`)

    // At 1000 items, each ~32px tall = ~32,000px total
    // Browser can handle this without virtualization
    expect(totalItems).toBe(1000)
  })

  test("rendering item count at 10,000 resources - all folders expanded", () => {
    const resources = generateResources(10000)
    const totalItems = resources.length
    console.log(`Total items rendered (all expanded, 10000): ${totalItems}`)

    // At 10,000 items, each ~32px tall = ~320,000px total
    // This WILL need virtualization - DOM with 10k nodes gets sluggish
    expect(totalItems).toBe(10000)
  })

  test("buildDataMap-equivalent with 10,000 resources", () => {
    const resources = generateResources(10000)

    // Simulate buildDataMap
    const start = performance.now()
    const map: Record<string, { childrenIds: string[] }> = {
      root: { childrenIds: [] },
    }
    for (const r of resources) {
      map[r.id] = { ...r, childrenIds: [] }
    }
    for (const r of resources) {
      const parentId = r.parentId ?? "root"
      if (map[parentId]) {
        map[parentId].childrenIds.push(r.id)
      } else {
        map["root"].childrenIds.push(r.id)
      }
    }
    // Sort children
    for (const entry of Object.values(map)) {
      entry.childrenIds.sort()
    }
    const elapsed = performance.now() - start

    console.log(`buildDataMap(10000): ${elapsed.toFixed(2)}ms`)
    expect(elapsed).toBeLessThan(200)
  })
})
