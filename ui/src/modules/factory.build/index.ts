import { lazy } from "react"
import type { ExtensionManifest } from "@rio.js/client"
import manifest from "./manifest.json"

export const extension = {
  ...manifest,
  refs: {
    "factory.build.route.home": lazy(
      () => import("./(app)/(dashboard)/build/page")
    ),
    "factory.build.route.repos": lazy(
      () => import("./(app)/(dashboard)/build/repos/page")
    ),
    "factory.build.route.systems": lazy(
      () => import("./(app)/(dashboard)/build/systems/page")
    ),
    "factory.build.route.components": lazy(
      () => import("./(app)/(dashboard)/build/components/page")
    ),
    "factory.build.route.system-detail": lazy(
      () => import("./(app)/(dashboard)/build/systems/[slug]/page")
    ),
    "factory.build.route.system-components": lazy(
      () => import("./(app)/(dashboard)/build/systems/[slug]/components/page")
    ),
    "factory.build.route.system-deployments": lazy(
      () => import("./(app)/(dashboard)/build/systems/[slug]/deployments/page")
    ),
    "factory.build.route.system-graph": lazy(
      () => import("./(app)/(dashboard)/build/systems/[slug]/graph/page")
    ),
  },
} satisfies ExtensionManifest
