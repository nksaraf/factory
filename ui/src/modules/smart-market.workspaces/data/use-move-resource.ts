import { useMutation, useQueryClient } from "@tanstack/react-query"

import type { Resource } from "../types"
import { workspaceFetch } from "../utils/api"
import { generateSortKeyBetween } from "../utils/sort-keys"

interface MoveResourceInput {
  resourceId: string
  newParentId: string | null
  /** Sort key of the item immediately BEFORE the new position (above it) */
  afterSortKey?: string | null
  /** Sort key of the item immediately AFTER the new position (below it) */
  beforeSortKey?: string | null
}

export function useMoveResource(workspaceId: string) {
  const queryClient = useQueryClient()
  const queryKey = ["workspace", workspaceId, "tree"]

  return useMutation({
    mutationFn: ({ resourceId, ...body }: MoveResourceInput) =>
      workspaceFetch<Resource>(`/resources/${resourceId}/move`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onMutate: async ({
      resourceId,
      newParentId,
      afterSortKey,
      beforeSortKey,
    }) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<Resource[]>(queryKey)

      queryClient.setQueryData<Resource[]>(queryKey, (old = []) =>
        old.map((r) => {
          if (r.id !== resourceId) return r

          let sortKey: string
          if (afterSortKey || beforeSortKey) {
            sortKey = generateSortKeyBetween(afterSortKey, beforeSortKey)
          } else {
            // No sort hints = append at end
            const siblings = old.filter(
              (s) =>
                s.id !== resourceId &&
                (newParentId
                  ? s.parentId === newParentId
                  : s.parentId === null) &&
                !s.deletedAt
            )
            const maxKey = siblings.reduce(
              (max, s) => (s.sortKey > max ? s.sortKey : max),
              ""
            )
            sortKey = generateSortKeyBetween(maxKey || null, null)
          }

          return {
            ...r,
            parentId: newParentId,
            sortKey,
            updatedAt: new Date().toISOString(),
          }
        })
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
