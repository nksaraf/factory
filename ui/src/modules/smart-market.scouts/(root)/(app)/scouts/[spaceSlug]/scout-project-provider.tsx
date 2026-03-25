import { db, storage } from "~/src/db"

import { rio } from "@rio.js/client"
import { env } from "@rio.js/env"
import { WebGISProvider } from "@rio.js/gis/components/web-gis-provider"
import { toast } from "@rio.js/ui/use-toast"

export function ScoutProjectProvider({ name, children }) {
  return (
    <>
      <WebGISProvider
        initialProject={{
          maps: {
            main: {
              id: "main",
              provider: "google",
              style: "light-street",
              visible: true,
              settings: {
                apiKey: env.PUBLIC_GOOGLE_MAPS_API_KEY,
              },
            },
          },
        }}
        key={"scouts"}
        refreshProject={() => {
          void Promise.resolve()
        }}
        id={"scouts"}
        onProjectChange={() => {
          return true
        }}
      >
        {children}
      </WebGISProvider>
    </>
  )
}
