import { env } from "@rio.js/env"

import type { Road, RoadGeometry } from "../roads-data"

/**
 * Fetches a single road's geometry from traffic_segments_for_tiles by road_id.
 * Used for hover/selection highlight when the roads list is requested without geometry (include_geometry=false).
 */
export async function fetchRoadGeometry(
  roadId: string | null | undefined
): Promise<RoadGeometry | null> {
  if (!roadId) return null
  try {
    const url = new URL(
      `${env.PUBLIC_TRAFFICURE_API_BASE_URL}/api/internal/crud/traffic_segments_for_tiles`
    )
    url.searchParams.set("road_id", `eq.${roadId}`)

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    })

    if (!response.ok) return null
    const data = await response.json()
    const segment = Array.isArray(data) && data.length > 0 ? data[0] : null
    const geom = segment?.geom ?? segment?.geometry
    if (!geom?.coordinates?.length) return null
    return {
      type: "LineString",
      crs: {
        type: "name",
        properties: { name: "EPSG:4326" },
      },
      coordinates: geom.coordinates as [number, number][],
    }
  } catch (error) {
    console.warn(`Failed to fetch road geometry for ${roadId}:`, error)
    return null
  }
}

/**
 * Fetches geometry for multiple roads from traffic_segments_for_tiles by road_id list.
 * Used when filtering is active - get geometry only for filtered roads.
 */
export async function fetchRoadsGeometry(roadIds: string[]): Promise<Road[]> {
  if (!roadIds?.length) return []
  try {
    const url = new URL(
      `${env.PUBLIC_TRAFFICURE_API_BASE_URL}/api/internal/crud/traffic_segments_for_tiles`
    )
    // PostgREST "in" operator: road_id=in.(id1,id2,id3)
    url.searchParams.set("road_id", `in.(${roadIds.join(",")})`)

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    })

    if (!response.ok) return []
    const data: Road[] = await response.json()
    return Array.isArray(data) ? data : []
  } catch (error) {
    console.warn("Failed to fetch roads geometry:", error)
    return []
  }
}
