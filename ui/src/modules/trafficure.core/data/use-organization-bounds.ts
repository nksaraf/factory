import { skipToken } from "@tanstack/react-query"

import { useCurrentOrganization } from "@rio.js/auth-ui/hooks/use-current-organization"
import { useQuery } from "@rio.js/client"
import { env } from "@rio.js/env"

export function useOrganizationBounds() {
  const { data: activeOrganization } = useCurrentOrganization()
  const { data: orgBounds } = useQuery({
    queryKey: activeOrganization?.id
      ? ["bounds", activeOrganization?.id]
      : skipToken,
    queryFn: async () => {
      const response = await fetch(
        `${env.PUBLIC_TRAFFICURE_API_BASE_URL}/api/internal/crud/cities?organization_id=eq.${activeOrganization.id}`
      )
      if (!response.ok) {
        throw new Error("Failed to fetch city")
      }
      const city = await response.json()
      if (!city || !city.length) {
        return {
          //bounds of India
          bounds: [
            [68.18, 8.47],
            [97.4, 37.06],
          ],
        }
      }
      return {
        bounds: [
          [city[0].bbox[0], city[0].bbox[1]],
          [city[0].bbox[2], city[0].bbox[3]],
        ],
      }
    },
  })

  return orgBounds
}
