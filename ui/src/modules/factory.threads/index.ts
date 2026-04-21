import { lazy } from "react"

import type { ExtensionManifest } from "@rio.js/client"

import manifest from "./manifest.json"

export const extension = {
  ...manifest,
  refs: {
    "factory.threads.route.home": lazy(
      () => import("./(app)/(dashboard)/threads/page")
    ),
    "factory.threads.route.plans": lazy(
      () => import("./(app)/(dashboard)/plans/page")
    ),
  },
} satisfies ExtensionManifest
