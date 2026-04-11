import type { InstallRole } from "@smp/factory-shared/install-types"

import type { DxConfig } from "../config.js"

const RESOURCE_PROFILES = {
  small: {
    apiCpu: "250m",
    apiMemory: "512Mi",
    reconcilerCpu: "100m",
    reconcilerMemory: "256Mi",
  },
  medium: {
    apiCpu: "500m",
    apiMemory: "1Gi",
    reconcilerCpu: "250m",
    reconcilerMemory: "512Mi",
  },
  large: {
    apiCpu: "1000m",
    apiMemory: "2Gi",
    reconcilerCpu: "500m",
    reconcilerMemory: "1Gi",
  },
} as const

/** Translate DxConfig into flat Helm values. Only for site/factory cluster installs. */
export function configToHelmValues(
  config: DxConfig
): Record<string, string | boolean | number> {
  const role = config.role as InstallRole
  const profile =
    RESOURCE_PROFILES[
      (config.resourceProfile as keyof typeof RESOURCE_PROFILES) || "small"
    ]

  const values: Record<string, string | boolean | number> = {
    "global.siteName": config.siteName,
    "global.domain": config.domain,
    "global.role": role,
    "dx-api.enabled": true,
    "dx-api.mode": role,
    "dx-api.resources.requests.cpu": profile.apiCpu,
    "dx-api.resources.requests.memory": profile.apiMemory,
    "dx-reconciler.enabled": true,
    "dx-reconciler.resources.requests.cpu": profile.reconcilerCpu,
    "dx-reconciler.resources.requests.memory": profile.reconcilerMemory,
    "traefik.enabled": true,
    "tls.mode": config.tlsMode,
    "database.mode": config.databaseMode,
    "registry.mode": config.registryMode,
    "network.podCidr": config.networkPodCidr,
    "network.serviceCidr": config.networkServiceCidr,
    "admin.email": config.adminEmail,
    "dx-builder.enabled": role === "factory",
    "ops-plane.enabled": role === "factory",
    "commerce-plane.enabled": role === "factory",
    "product-plane.enabled": role === "factory",
    "observability.aggregation.enabled": role === "factory",
  }

  if (config.tlsCertPath) values["tls.certPath"] = config.tlsCertPath
  if (config.tlsKeyPath) values["tls.keyPath"] = config.tlsKeyPath
  if (config.databaseMode === "external" && config.databaseUrl) {
    values["database.url"] = config.databaseUrl
  }
  if (config.registryMode === "external" && config.registryUrl) {
    values["registry.url"] = config.registryUrl
  }

  return values
}

export function helmValuesToSetArgs(
  values: Record<string, string | boolean | number>
): string[] {
  return Object.entries(values).flatMap(([k, v]) => ["--set", `${k}=${v}`])
}
