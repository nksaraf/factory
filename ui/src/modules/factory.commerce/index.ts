import { lazy } from "react"

import type { ExtensionManifest } from "@rio.js/client"

import manifest from "./manifest.json"

export const extension = {
  ...manifest,
  refs: {
    "factory.commerce.route.home": lazy(
      () => import("./(app)/(dashboard)/commerce/page")
    ),
    "factory.commerce.route.customers": lazy(
      () => import("./(app)/(dashboard)/commerce/customers/page")
    ),
    "factory.commerce.route.customer-detail": lazy(
      () => import("./(app)/(dashboard)/commerce/customers/[slug]/page")
    ),
    "factory.commerce.route.customer-layout": lazy(
      () => import("./(app)/(dashboard)/commerce/customers/[slug]/layout")
    ),
    "factory.commerce.route.customer-subscriptions": lazy(
      () =>
        import("./(app)/(dashboard)/commerce/customers/[slug]/subscriptions/page")
    ),
    "factory.commerce.route.customer-bundles": lazy(
      () => import("./(app)/(dashboard)/commerce/customers/[slug]/bundles/page")
    ),
    "factory.commerce.route.plans": lazy(
      () => import("./(app)/(dashboard)/commerce/plans/page")
    ),
    "factory.commerce.route.plan-detail": lazy(
      () => import("./(app)/(dashboard)/commerce/plans/[slug]/page")
    ),
    "factory.commerce.route.subscriptions": lazy(
      () => import("./(app)/(dashboard)/commerce/subscriptions/page")
    ),
    "factory.commerce.route.subscription-detail": lazy(
      () => import("./(app)/(dashboard)/commerce/subscriptions/[id]/page")
    ),
  },
} satisfies ExtensionManifest
