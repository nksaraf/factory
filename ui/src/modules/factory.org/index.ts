import { lazy } from "react"
import type { ExtensionManifest } from "@rio.js/client"
import manifest from "./manifest.json"

export const extension = {
  ...manifest,
  refs: {
    "factory.org.route.home": lazy(
      () => import("./(app)/(dashboard)/org/page")
    ),
    "factory.org.route.principals": lazy(
      () => import("./(app)/(dashboard)/org/principals/page")
    ),
    "factory.org.route.principal-detail": lazy(
      () => import("./(app)/(dashboard)/org/principals/[slug]/page")
    ),
    "factory.org.route.principal-identities": lazy(
      () => import("./(app)/(dashboard)/org/principals/[slug]/identities/page")
    ),
    "factory.org.route.principal-timeline": lazy(
      () => import("./(app)/(dashboard)/org/principals/[slug]/timeline/page")
    ),
    "factory.org.route.teams": lazy(
      () => import("./(app)/(dashboard)/org/teams/page")
    ),
    "factory.org.route.team-detail": lazy(
      () => import("./(app)/(dashboard)/org/teams/[slug]/page")
    ),
    "factory.org.route.secrets": lazy(
      () => import("./(app)/(dashboard)/org/secrets/page")
    ),
    "factory.org.route.roles": lazy(
      () => import("./(app)/(dashboard)/org/roles/page")
    ),
  },
} satisfies ExtensionManifest
