// ui/src/modules/factory.fleet/index.ts
import { lazy } from "react"

import type { ExtensionManifest } from "@rio.js/client"

import manifest from "./manifest.json"

export const extension = {
  ...manifest,
  refs: {
    "factory.fleet.route.home": lazy(
      () => import("./(app)/(dashboard)/fleet/page")
    ),
    "factory.fleet.route.sites": lazy(
      () => import("./(app)/(dashboard)/fleet/sites/page")
    ),
    "factory.fleet.route.site-detail": lazy(
      () => import("./(app)/(dashboard)/fleet/sites/[slug]/page")
    ),
    "factory.fleet.route.targets": lazy(
      () => import("./(app)/(dashboard)/fleet/targets/page")
    ),
    "factory.fleet.route.target-detail": lazy(
      () => import("./(app)/(dashboard)/fleet/targets/[slug]/page")
    ),
    "factory.fleet.route.releases": lazy(
      () => import("./(app)/(dashboard)/fleet/releases/page")
    ),
    "factory.fleet.route.rollouts": lazy(
      () => import("./(app)/(dashboard)/fleet/rollouts/page")
    ),
    "factory.fleet.route.incidents": lazy(
      () => import("./(app)/(dashboard)/fleet/incidents/page")
    ),
    "factory.fleet.route.sandboxes": lazy(
      () => import("./(app)/(dashboard)/fleet/sandboxes/page")
    ),
    "factory.fleet.route.routes": lazy(
      () => import("./(app)/(dashboard)/fleet/routes/page")
    ),
    "factory.fleet.route.workloads": lazy(
      () => import("./(app)/(dashboard)/fleet/workloads/[id]/page")
    ),
    "factory.fleet.route.drift": lazy(
      () => import("./(app)/(dashboard)/fleet/drift/page")
    ),
    "factory.fleet.route.interventions": lazy(
      () => import("./(app)/(dashboard)/fleet/interventions/page")
    ),
    "factory.fleet.route.bundles": lazy(
      () => import("./(app)/(dashboard)/fleet/bundles/page")
    ),
  },
} satisfies ExtensionManifest
