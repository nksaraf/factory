import { useLazyQuery } from "@rio.js/client"
import { getRoadDetail } from "../utils/roads-mock"
import type { RoadDetail, RoadId } from "../utils/roads-mock"

/**
 * Hook to fetch road detail data for a given roadId.
 * Returns null in query function if roadId is not provided.
 */
export function useRoadDataQuery(roadId: RoadId | null | undefined) {
  const { data, ...rest } = useLazyQuery<RoadDetail | null>({
    queryKey: ["analytics", "road", roadId],
    enabled: !!roadId,
    refetchOnMount: true,
    queryFn: async () => {
      if (!roadId) {
        return null
      }

      return await getRoadDetail(roadId)
    },
    staleTime: 10000, // 10 seconds
    refetchInterval: 10000, // Refetch every 10 seconds
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  })

  return {
    data,
    ...rest,
  }
}

