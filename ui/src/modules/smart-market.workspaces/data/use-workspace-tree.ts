import { useSuspenseQuery } from "@tanstack/react-query"

import type { Resource } from "../types"
import { workspaceFetch } from "../utils/api"

export function useWorkspaceTree(workspaceId: string | undefined) {
  return useSuspenseQuery<Resource[]>({
    queryKey: ["workspace", workspaceId, "tree"],
    queryFn: () =>
      workspaceFetch<Resource[]>(`/workspaces/${workspaceId}/tree`),
  })
}
