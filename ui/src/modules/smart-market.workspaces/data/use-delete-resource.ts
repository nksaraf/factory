import { useMutation, useQueryClient } from "@tanstack/react-query"

import type { Resource } from "../types"
import { workspaceFetch } from "../utils/api"

export function useDeleteResource(workspaceId: string) {
  const queryClient = useQueryClient()
  const queryKey = ["workspace", workspaceId, "tree"]

  return useMutation({
    mutationFn: (resourceId: string) =>
      workspaceFetch(`/resources/${resourceId}/delete`, { method: "POST" }),
    onMutate: async (resourceId) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<Resource[]>(queryKey)

      queryClient.setQueryData<Resource[]>(queryKey, (old = []) =>
        old.filter((r) => r.id !== resourceId && r.parentId !== resourceId)
      )

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
