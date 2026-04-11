import { type ReactNode, createContext, use, useMemo } from "react"

import { useWorkspaceTree } from "../data/use-workspace-tree"
import type { Resource, TreeNode } from "../types"
import { buildTree } from "../utils/tree-builder"

interface WorkbenchContextValue {
  /** Remote workbench id (URL param; API still uses `/workspaces/:id` routes). */
  workspaceId: string
  resources: Resource[]
  tree: TreeNode[]
  isLoading: boolean
  error: Error | null
}

const WorkbenchContext = createContext<WorkbenchContextValue | null>(null)

export function WorkbenchProvider({
  workspaceId,
  children,
}: {
  workspaceId: string
  children: ReactNode
}) {
  const { data: resources, isLoading, error } = useWorkspaceTree(workspaceId)

  const tree = useMemo(() => buildTree(resources ?? []), [resources])

  const value = useMemo<WorkbenchContextValue>(
    () => ({
      workspaceId,
      resources: resources ?? [],
      tree,
      isLoading,
      error: error as Error | null,
    }),
    [workspaceId, resources, tree, isLoading, error]
  )

  return <WorkbenchContext value={value}>{children}</WorkbenchContext>
}

export function useWorkbench() {
  const ctx = use(WorkbenchContext)
  if (!ctx) {
    throw new Error("useWorkbench must be used within WorkbenchProvider")
  }
  return ctx
}
