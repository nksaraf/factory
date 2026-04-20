// ui/src/modules/factory.infra/index.ts
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
    "factory.infra.route.realms": lazy(
      () => import("./(app)/(dashboard)/infra/realms/page")
    ),
    "factory.infra.route.providers": lazy(
      () => import("./(app)/(dashboard)/infra/providers/page")
    ),
    "factory.infra.route.provider-detail": lazy(
      () => import("./(app)/(dashboard)/infra/providers/[slug]/page")
    ),
    "factory.infra.route.clusters": lazy(
      () => import("./(app)/(dashboard)/infra/clusters/page")
    ),
    "factory.infra.route.cluster-detail": lazy(
      () => import("./(app)/(dashboard)/infra/clusters/[slug]/page")
    ),
    "factory.infra.route.hosts": lazy(
      () => import("./(app)/(dashboard)/infra/hosts/page")
    ),
    "factory.infra.route.host-detail": lazy(
      () => import("./(app)/(dashboard)/infra/hosts/[slug]/page")
    ),
    "factory.infra.route.network": lazy(
      () => import("./(app)/(dashboard)/infra/network/page")
    ),
    "factory.infra.route.proxmox": lazy(
      () => import("./(app)/(dashboard)/infra/proxmox/page")
    ),
    "factory.infra.route.utilization": lazy(
      () => import("./(app)/(dashboard)/infra/utilization/page")
    ),
    "factory.infra.route.certs": lazy(
      () => import("./(app)/(dashboard)/infra/certs/page")
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
    "factory.infra.route.secrets": lazy(
      () => import("./(app)/(dashboard)/infra/secrets/page")
    ),
    "factory.infra.route.secret-detail": lazy(
      () => import("./(app)/(dashboard)/infra/secrets/[slug]/page")
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
  },
} satisfies ExtensionManifest
