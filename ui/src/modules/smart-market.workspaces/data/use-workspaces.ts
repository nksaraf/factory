import { useQuery } from "@tanstack/react-query"

import type { Workspace } from "../types"
import { workspaceFetch } from "../utils/api"

export function useWorkspaces() {
  return useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: () => workspaceFetch<Workspace[]>("/workspaces"),
  })
}
