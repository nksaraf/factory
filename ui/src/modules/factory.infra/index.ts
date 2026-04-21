import { lazy } from "react"

import type { ExtensionManifest } from "@rio.js/client"

import manifest from "./manifest.json"

export const extension = {
  ...manifest,
  refs: {
    "factory.infra.route.home": lazy(
      () => import("./(app)/(dashboard)/infra/page")
    ),
    "factory.infra.route.estates": lazy(
      () => import("./(app)/(dashboard)/infra/estates/page")
    ),
    "factory.infra.route.estate-detail": lazy(
      () => import("./(app)/(dashboard)/infra/estates/[slug]/page")
    ),
    "factory.infra.route.hosts": lazy(
      () => import("./(app)/(dashboard)/infra/hosts/page")
    ),
    "factory.infra.route.host-detail": lazy(
      () => import("./(app)/(dashboard)/infra/hosts/[slug]/page")
    ),
    "factory.infra.route.host-terminal": lazy(
      () => import("./(app)/(dashboard)/infra/hosts/[slug]/terminal/page")
    ),
    "factory.infra.route.host-files": lazy(
      () => import("./(app)/(dashboard)/infra/hosts/[slug]/files/page")
    ),
    "factory.infra.route.host-monitoring": lazy(
      () => import("./(app)/(dashboard)/infra/hosts/[slug]/monitoring/page")
    ),
    "factory.infra.route.host-activity": lazy(
      () => import("./(app)/(dashboard)/infra/hosts/[slug]/activity/page")
    ),
    "factory.infra.route.realms": lazy(
      () => import("./(app)/(dashboard)/infra/realms/page")
    ),
    "factory.infra.route.realm-detail": lazy(
      () => import("./(app)/(dashboard)/infra/realms/[slug]/page")
    ),
    "factory.infra.route.services": lazy(
      () => import("./(app)/(dashboard)/infra/services/page")
    ),
    "factory.infra.route.service-detail": lazy(
      () => import("./(app)/(dashboard)/infra/services/[slug]/page")
    ),
    "factory.infra.route.routes": lazy(
      () => import("./(app)/(dashboard)/infra/routes/page")
    ),
    "factory.infra.route.route-detail": lazy(
      () => import("./(app)/(dashboard)/infra/routes/[slug]/page")
    ),
    "factory.infra.route.dns": lazy(
      () => import("./(app)/(dashboard)/infra/dns/page")
    ),
    "factory.infra.route.dns-detail": lazy(
      () => import("./(app)/(dashboard)/infra/dns/[slug]/page")
    ),
    "factory.infra.route.tunnels": lazy(
      () => import("./(app)/(dashboard)/infra/tunnels/page")
    ),
    "factory.infra.route.tunnel-detail": lazy(
      () => import("./(app)/(dashboard)/infra/tunnels/[slug]/page")
    ),
  },
} satisfies ExtensionManifest
