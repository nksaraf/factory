import { useMutation, useQueryClient } from "@tanstack/react-query"

import type { Resource, ResourceType } from "../types"
import { workspaceFetch } from "../utils/api"

interface CreateResourceInput {
  parentId?: string
  name: string
  resourceType: ResourceType
}

export function useCreateResource(workspaceId: string) {
  const queryClient = useQueryClient()
  const queryKey = ["workspace", workspaceId, "tree"]

  return useMutation({
    mutationFn: (input: CreateResourceInput) =>
      workspaceFetch<Resource>(`/workspaces/${workspaceId}/resources/create`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<Resource[]>(queryKey)

      queryClient.setQueryData<Resource[]>(queryKey, (old = []) => [
        ...old,
        {
          id: `temp-${Date.now()}`,
          workspaceId,
          parentId: input.parentId ?? null,
          name: input.name,
          resourceType: input.resourceType,
          sortKey: "zz",
          createdBy: "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          deletedAt: null,
          deletedBy: null,
        },
      ])

      return { previous }
    },
    onError: (_err, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey })
    },
  })
}
