import { lazy } from "react"

import type { ExtensionManifest } from "@rio.js/client"

import manifest from "./manifest.json"

export const extension = {
  ...manifest,
  refs: {
    "factory.game-viz.route.home": lazy(
      () => import("./(app)/(dashboard)/game/page")
    ),
  },
} satisfies ExtensionManifest
