import { lazy } from "react"

import type { ExtensionManifest } from "@rio.js/client"

import manifest from "./manifest.json"

export const extension = {
  ...manifest,
  refs: {
    "factory.ops.route.home": lazy(
      () => import("./(app)/(dashboard)/ops/page")
    ),
    "factory.ops.route.sites": lazy(
      () => import("./(app)/(dashboard)/ops/sites/page")
    ),
    "factory.ops.route.site-detail": lazy(
      () => import("./(app)/(dashboard)/ops/sites/[slug]/page")
    ),
    "factory.ops.route.targets": lazy(
      () => import("./(app)/(dashboard)/ops/targets/page")
    ),
    "factory.ops.route.target-detail": lazy(
      () => import("./(app)/(dashboard)/ops/targets/[slug]/page")
    ),
    "factory.ops.route.releases": lazy(
      () => import("./(app)/(dashboard)/ops/releases/page")
    ),
    "factory.ops.route.rollouts": lazy(
      () => import("./(app)/(dashboard)/ops/rollouts/page")
    ),
    "factory.ops.route.incidents": lazy(
      () => import("./(app)/(dashboard)/ops/incidents/page")
    ),
    "factory.ops.route.sandboxes": lazy(
      () => import("./(app)/(dashboard)/ops/sandboxes/page")
    ),
    "factory.ops.route.routes": lazy(
      () => import("./(app)/(dashboard)/ops/routes/page")
    ),
    "factory.ops.route.workloads": lazy(
      () => import("./(app)/(dashboard)/ops/workloads/[id]/page")
    ),
    "factory.ops.route.drift": lazy(
      () => import("./(app)/(dashboard)/ops/drift/page")
    ),
    "factory.ops.route.interventions": lazy(
      () => import("./(app)/(dashboard)/ops/interventions/page")
    ),
    "factory.ops.route.bundles": lazy(
      () => import("./(app)/(dashboard)/ops/bundles/page")
    ),
  },
} satisfies ExtensionManifest
