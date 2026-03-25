import { useQuery } from "@tanstack/react-query"

import type { ResourceType } from "../types"
import { workspaceFetch } from "../utils/api"

export interface ActivityItem {
  id: string
  type: string
  actorName: string
  resourceName: string
  resourceType: ResourceType
  timestamp: string
  description: string
}

export function useWorkspaceActivity(workspaceId: string) {
  return useQuery<ActivityItem[]>({
    queryKey: ["workspace", workspaceId, "activity"],
    queryFn: () =>
      workspaceFetch<ActivityItem[]>(`/workspaces/${workspaceId}/activity`),
    enabled: !!workspaceId,
  })
}
