import { lazy } from "react"

import { ExtensionManifest } from "@rio.js/client"

import manifest from "./manifest.json"

export const extension = {
  ...manifest,
  refs: {
    "smart-market.docs.route.layout": {
      Component: lazy(() => import("./(root)/(app)/docs/layout")),
    },
    "smart-market.docs.route.index.page": {
      Component: lazy(() => import("./(root)/(app)/docs/page")),
    },
    "smart-market.docs.route.slug.page": {
      Component: lazy(() => import("./(root)/(app)/docs/[...slug]/page")),
    },
  },
} satisfies ExtensionManifest
