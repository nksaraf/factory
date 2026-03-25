import type { Resource, TreeNode } from "../types"

export function buildTree(flatResources: Resource[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>()
  const roots: TreeNode[] = []

  for (const resource of flatResources) {
    nodeMap.set(resource.id, { ...resource, children: [] })
  }

  for (const resource of flatResources) {
    const node = nodeMap.get(resource.id)!
    if (resource.parentId && nodeMap.has(resource.parentId)) {
      nodeMap.get(resource.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

export function flattenTree(nodes: TreeNode[]): Resource[] {
  const result: Resource[] = []
  function walk(items: TreeNode[]) {
    for (const item of items) {
      const { children, ...resource } = item
      result.push(resource)
      walk(children)
    }
  }
  walk(nodes)
  return result
}

export function findNodeById(
  nodes: TreeNode[],
  id: string
): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findNodeById(node.children, id)
    if (found) return found
  }
  return null
}
