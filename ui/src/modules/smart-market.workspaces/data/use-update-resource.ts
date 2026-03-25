import { useMutation, useQueryClient } from "@tanstack/react-query"

import type { Resource } from "../types"
import { workspaceFetch } from "../utils/api"

interface UpdateResourceInput {
  name?: string
  sortKey?: string
}

export function useUpdateResource(workspaceId: string) {
  const queryClient = useQueryClient()
  const queryKey = ["workspace", workspaceId, "tree"]

  return useMutation({
    mutationFn: ({
      resourceId,
      ...input
    }: UpdateResourceInput & { resourceId: string }) =>
      workspaceFetch<Resource>(`/resources/${resourceId}/update`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onMutate: async ({ resourceId, ...input }) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<Resource[]>(queryKey)

      queryClient.setQueryData<Resource[]>(queryKey, (old = []) =>
        old.map((r) =>
          r.id === resourceId
            ? { ...r, ...input, updatedAt: new Date().toISOString() }
            : r
        )
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
