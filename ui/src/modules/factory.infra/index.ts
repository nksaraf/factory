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
    "factory.infra.route.vms": lazy(
      () => import("./(app)/(dashboard)/infra/vms/page")
    ),
    "factory.infra.route.vm-detail": lazy(
      () => import("./(app)/(dashboard)/infra/vms/[slug]/page")
    ),
    "factory.infra.route.network": lazy(
      () => import("./(app)/(dashboard)/infra/network/page")
    ),
    "factory.infra.route.nodes": lazy(
      () => import("./(app)/(dashboard)/infra/clusters/[clusterId]/nodes/[slug]/page")
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
  },
} satisfies ExtensionManifest
