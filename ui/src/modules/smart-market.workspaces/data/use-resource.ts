import { useQuery } from "@tanstack/react-query"

import type { ResourceDetail } from "../types"
import { workspaceFetch } from "../utils/api"

export function useResource(resourceId: string | undefined) {
  return useQuery<ResourceDetail>({
    queryKey: ["workspace", "resource", resourceId],
    enabled: !!resourceId,
    queryFn: () => workspaceFetch<ResourceDetail>(`/resources/${resourceId}`),
  })
}
