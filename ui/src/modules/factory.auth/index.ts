import { lazy } from "react"

import type { ExtensionManifest } from "@rio.js/client"

import manifest from "./manifest.json"
import AuthUIProviderWrapper from "./auth-ui-provider-wrapper"

export const extension = {
  ...manifest,
  refs: {
    "factory.auth.route.page": lazy(() => import("./auth-page")),
    "factory.auth.providers.auth-ui": AuthUIProviderWrapper,
  },
} satisfies ExtensionManifest
