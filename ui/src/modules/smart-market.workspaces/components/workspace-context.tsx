import { type ReactNode, createContext, use, useMemo } from "react"

import { useWorkspaceTree } from "../data/use-workspace-tree"
import type { Resource, TreeNode } from "../types"
import { buildTree } from "../utils/tree-builder"

interface WorkspaceContextValue {
  workspaceId: string
  resources: Resource[]
  tree: TreeNode[]
  isLoading: boolean
  error: Error | null
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({
  workspaceId,
  children,
}: {
  workspaceId: string
  children: ReactNode
}) {
  const { data: resources, isLoading, error } = useWorkspaceTree(workspaceId)

  const tree = useMemo(() => buildTree(resources ?? []), [resources])

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaceId,
      resources: resources ?? [],
      tree,
      isLoading,
      error: error as Error | null,
    }),
    [workspaceId, resources, tree, isLoading, error]
  )

  return <WorkspaceContext value={value}>{children}</WorkspaceContext>
}

export function useWorkspace() {
  const ctx = use(WorkspaceContext)
  if (!ctx) {
    throw new Error("useWorkspace must be used within WorkspaceProvider")
  }
  return ctx
}
