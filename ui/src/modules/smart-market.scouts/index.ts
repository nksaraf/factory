import { lazy } from "react"

import { ExtensionManifest } from "@rio.js/client"

import { loader as scoutsLayoutLoader } from "./(root)/(app)/scouts/[spaceSlug]/layout?pick=loader"
import manifest from "./manifest.json"

export const extension = {
  ...manifest,
  refs: {
    "smart-market.scouts.route.redirect.layout": {
      Component: lazy(() => import("./(root)/(app)/scouts/layout")),
    },
    "smart-market.scouts.route.redirect.page": {
      Component: lazy(() => import("./(root)/(app)/scouts/page")),
    },
    "smart-market.scouts.route.layout": {
      Component: lazy(() => import("./(root)/(app)/scouts/[spaceSlug]/layout")),
      loader: scoutsLayoutLoader,
    },
    "smart-market.scouts.route.page": {
      Component: lazy(() => import("./(root)/(app)/scouts/[spaceSlug]/page")),
    },
    "smart-market.scouts.route.session.page": {
      Component: lazy(
        () => import("./(root)/(app)/scouts/[spaceSlug]/[sessionId]/page")
      ),
    },
  },
} satisfies ExtensionManifest
