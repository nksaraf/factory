import { lazy } from "react"

import type { ExtensionManifest } from "@rio.js/client"

import manifest from "./manifest.json"

export const extension = {
  ...manifest,
  refs: {
    "factory.workbench.route.home": lazy(
      () => import("./(app)/(dashboard)/workbench/page")
    ),
    "factory.workbench.route.site": lazy(
      () => import("./(app)/(dashboard)/workbench/[site-slug]/page")
    ),
  },
} satisfies ExtensionManifest
