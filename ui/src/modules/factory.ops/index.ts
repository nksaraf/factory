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
    "factory.ops.route.site-layout": lazy(
      () => import("./(app)/(dashboard)/ops/sites/[slug]/layout")
    ),
    "factory.ops.route.site-systems": lazy(
      () => import("./(app)/(dashboard)/ops/sites/[slug]/systems/page")
    ),
    "factory.ops.route.site-components": lazy(
      () => import("./(app)/(dashboard)/ops/sites/[slug]/components/page")
    ),
    "factory.ops.route.site-deployments": lazy(
      () => import("./(app)/(dashboard)/ops/sites/[slug]/deployments/page")
    ),
    "factory.ops.route.system-deployments": lazy(
      () => import("./(app)/(dashboard)/ops/system-deployments/page")
    ),
    "factory.ops.route.system-deployment-detail": lazy(
      () => import("./(app)/(dashboard)/ops/system-deployments/[slug]/page")
    ),
    "factory.ops.route.component-deployments": lazy(
      () => import("./(app)/(dashboard)/ops/component-deployments/page")
    ),
    "factory.ops.route.component-deployment-detail": lazy(
      () => import("./(app)/(dashboard)/ops/component-deployments/[id]/page")
    ),
    "factory.ops.route.workbenches": lazy(
      () => import("./(app)/(dashboard)/ops/workbenches/page")
    ),
    "factory.ops.route.workbench-detail": lazy(
      () => import("./(app)/(dashboard)/ops/workbenches/[slug]/page")
    ),
    "factory.ops.route.rollouts": lazy(
      () => import("./(app)/(dashboard)/ops/rollouts/page")
    ),
    "factory.ops.route.rollout-detail": lazy(
      () => import("./(app)/(dashboard)/ops/rollouts/[id]/page")
    ),
    "factory.ops.route.interventions": lazy(
      () => import("./(app)/(dashboard)/ops/interventions/page")
    ),
    "factory.ops.route.intervention-detail": lazy(
      () => import("./(app)/(dashboard)/ops/interventions/[id]/page")
    ),
    "factory.ops.route.databases": lazy(
      () => import("./(app)/(dashboard)/ops/databases/page")
    ),
    "factory.ops.route.database-detail": lazy(
      () => import("./(app)/(dashboard)/ops/databases/[slug]/page")
    ),
  },
} satisfies ExtensionManifest
