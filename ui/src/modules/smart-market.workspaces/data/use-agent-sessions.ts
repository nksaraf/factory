import { useQuery } from "@tanstack/react-query"

import { workspaceFetch } from "../utils/api"

export interface AgentSessionSummary {
  id: string
  workspaceId: string
  parentId: string | null
  name: string
  agentName: string
  model?: string
  status: "active" | "completed" | "error"
  messageCount: number
  lastMessagePreview?: string
  startedAt: string
  updatedAt: string
}

export function useAgentSessions(workspaceId: string | undefined) {
  return useQuery<AgentSessionSummary[]>({
    queryKey: ["workspace", workspaceId, "agent-sessions"],
    enabled: !!workspaceId,
    queryFn: () =>
      workspaceFetch<AgentSessionSummary[]>(
        `/workspaces/${workspaceId}/agent-sessions`
      ),
  })
}
