import React, { useState, useEffect } from "react"
import { Box, Text, useInput } from "ink"
import { useSelection, type Selection } from "../hooks/use-selection.js"

export interface TreeNode {
  id: string
  name: string
  slug?: string
  type: "substrate" | "runtime" | "workspace"
  status?: string
  children?: TreeNode[]
  substrateId?: string
  runtimeId?: string
  /** Unique key for this node in the tree — set by the parent to disambiguate duplicates */
  treeKey?: string
}

interface ResourceTreeProps {
  nodes: TreeNode[]
  focused: boolean
}

function statusIcon(status?: string): { char: string; color: string } {
  switch (status) {
    case "active":
    case "running":
    case "ready":
    case "healthy":
    case "connected":
      return { char: "●", color: "green" }
    case "provisioning":
    case "pending":
    case "creating":
    case "building":
    case "syncing":
      return { char: "◐", color: "yellow" }
    case "stopped":
    case "error":
    case "failed":
    case "destroyed":
      return { char: "○", color: "red" }
    default:
      return { char: "●", color: "gray" }
  }
}

interface FlatItem {
  node: TreeNode
  depth: number
  expanded: boolean
  hasChildren: boolean
  /** Unique path-based key for React rendering */
  treeKey: string
}

function flattenTree(
  nodes: TreeNode[],
  expandedSet: Set<string>,
  depth = 0,
  parentPath = ""
): FlatItem[] {
  const result: FlatItem[] = []
  for (const node of nodes) {
    const hasChildren = (node.children?.length ?? 0) > 0
    const expanded = expandedSet.has(node.id)
    const treeKey = parentPath ? `${parentPath}/${node.type}-${node.id}` : `${node.type}-${node.id}`
    result.push({ node, depth, expanded, hasChildren, treeKey })
    if (expanded && node.children) {
      result.push(...flattenTree(node.children, expandedSet, depth + 1, treeKey))
    }
  }
  return result
}

export function ResourceTree({ nodes, focused }: ResourceTreeProps) {
  const [expandedSet, setExpandedSet] = useState<Set<string>>(new Set())
  const [cursorIndex, setCursorIndex] = useState(0)
  const { selection, setSelection } = useSelection()

  const flatItems = flattenTree(nodes, expandedSet)

  // Clamp cursor
  useEffect(() => {
    if (cursorIndex >= flatItems.length && flatItems.length > 0) {
      setCursorIndex(flatItems.length - 1)
    }
  }, [flatItems.length, cursorIndex])

  // Auto-expand root nodes on first data
  useEffect(() => {
    if (nodes.length > 0 && expandedSet.size === 0) {
      setExpandedSet(new Set(nodes.map((n) => n.id)))
    }
  }, [nodes.length])

  const toggleExpand = (id: string) => {
    setExpandedSet((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  useInput(
    (input, key) => {
      if (!focused || flatItems.length === 0) return

      if (key.upArrow) {
        setCursorIndex((i) => Math.max(0, i - 1))
      } else if (key.downArrow) {
        setCursorIndex((i) => Math.min(flatItems.length - 1, i + 1))
      } else if (key.rightArrow) {
        const item = flatItems[cursorIndex]
        if (item?.hasChildren && !item.expanded) {
          toggleExpand(item.node.id)
        }
      } else if (key.leftArrow) {
        const item = flatItems[cursorIndex]
        if (item?.hasChildren && item.expanded) {
          toggleExpand(item.node.id)
        }
      } else if (key.return) {
        const item = flatItems[cursorIndex]
        if (!item) return
        if (item.hasChildren) {
          toggleExpand(item.node.id)
        }
        // Always update selection
        setSelection({
          type: item.node.type,
          id: item.node.id,
          name: item.node.name,
          runtimeId: item.node.runtimeId,
          substrateId: item.node.substrateId,
        })
      }
    },
    { isActive: focused }
  )

  // Sync selection on cursor move
  useEffect(() => {
    const item = flatItems[cursorIndex]
    if (item) {
      setSelection({
        type: item.node.type,
        id: item.node.id,
        name: item.node.name,
        runtimeId: item.node.runtimeId,
        substrateId: item.node.substrateId,
      })
    }
  }, [cursorIndex])

  if (flatItems.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text dimColor>No infrastructure resources found.</Text>
        <Text dimColor>Is the factory API running?</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Box paddingX={1} marginBottom={1}>
        <Text bold>Resources</Text>
      </Box>
      {flatItems.map((item, index) => {
        const isCursor = index === cursorIndex && focused
        const icon = statusIcon(item.node.status)
        const indent = "  ".repeat(item.depth)
        const chevron = item.hasChildren
          ? item.expanded
            ? "▾ "
            : "▸ "
          : "  "

        return (
          <Box key={item.treeKey} paddingX={1}>
            <Text
              backgroundColor={isCursor ? "blue" : undefined}
              color={isCursor ? "white" : undefined}
            >
              {indent}
              {chevron}
              <Text color={icon.color}>{icon.char}</Text>{" "}
              {item.node.name}
              {item.node.slug && item.node.slug !== item.node.name && (
                <Text dimColor={!isCursor}> {item.node.slug}</Text>
              )}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}
