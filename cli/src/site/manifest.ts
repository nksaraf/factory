/**
 * Site manifest — the controller's source of truth.
 *
 * Comes from Factory (connected mode), a pushed file (air-gapped),
 * or is derived locally (standalone).
 */
import type { CatalogSystem } from "@smp/factory-shared/catalog"

export interface ManifestSystemDeployment {
  id: string
  name: string
  site: string
  realmType: string
  namespace?: string
  labels?: Record<string, string>
}

export interface ManifestComponentDeployment {
  id: string
  componentName: string
  desiredImage: string
  trackedImageRef?: string
  replicas: number
  envOverrides: Record<string, string>
  resourceOverrides: Record<string, string>
  status: "running" | "stopped" | "provisioning"
}

export interface ManifestGatewayRoute {
  host: string
  path: string
  service: string
  port: number
  tls?: boolean
  middlewares?: string[]
}

export interface ManifestGateway {
  manifestVersion: number
  manifestHash: string
  targetRelease?: string
  configuration?: Record<string, unknown>
  routes: ManifestGatewayRoute[]
  domains: string[]
}

export interface SiteManifest {
  version: number
  systemDeployment: ManifestSystemDeployment
  componentDeployments: ManifestComponentDeployment[]
  catalog: CatalogSystem
  gateway?: ManifestGateway
}
