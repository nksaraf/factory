import { queryOptions, useQuery } from "@rio.js/client"
import { env } from "@rio.js/env"
import type { Road } from "../roads-data"
import {
  type RoadId,
  getRoadDetail,
} from "../utils/roads-mock"

async function getMockRoadList(): Promise<Road[]> {
  try {
    const url = new URL(
      `${env.PUBLIC_TRAFFICURE_API_BASE_URL}/api/internal/crud/traffic_segments_for_tiles`
    )
    
    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
      },
    })

    if (response.ok) {
      const data: Road[] = await response.json()
      return data || []
    }
  } catch (error) {
    console.warn("Failed to fetch roads list:", error)
  }
  return []
}

export function roadsListQueryOptions() {
  return queryOptions({
    queryKey: ["analytics", "roads"],
    queryFn: async () => getMockRoadList(),
  })
}

export function roadDetailQueryOptions(roadId: RoadId | null | undefined) {
  return queryOptions({
    queryKey: ["analytics", "road", roadId],
    enabled: Boolean(roadId),
    queryFn: async () => (roadId ? getRoadDetail(roadId) : null),
  })
}

export function useRoadsListQuery() {
  return useQuery(roadsListQueryOptions())
}

export function useRoadDetailQuery(roadId: RoadId | null | undefined) {
  return useQuery(roadDetailQueryOptions(roadId))
}
