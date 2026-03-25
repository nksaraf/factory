import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { siteConfigSchema, type SiteConfig } from "@smp/factory-shared/site-config-schema";
import type { InstallRole } from "@smp/factory-shared/install-types";

/**
 * Load and validate a site config.yaml from disk.
 * @param configPath Path to config.yaml (default: ./config.yaml in cwd)
 */
export function loadSiteConfig(configPath?: string): SiteConfig {
  const file = resolve(configPath ?? "config.yaml");
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new Error(`Cannot read config file: ${file}`);
  }

  const parsed = parseYaml(raw);
  const result = siteConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid config.yaml:\n${issues}`);
  }
  return result.data;
}

/** Resource profiles: CPU/memory requests per component. */
const RESOURCE_PROFILES = {
  small: { apiCpu: "250m", apiMemory: "512Mi", reconcilerCpu: "100m", reconcilerMemory: "256Mi" },
  medium: { apiCpu: "500m", apiMemory: "1Gi", reconcilerCpu: "250m", reconcilerMemory: "512Mi" },
  large: { apiCpu: "1000m", apiMemory: "2Gi", reconcilerCpu: "500m", reconcilerMemory: "1Gi" },
} as const;

/**
 * Translate a validated SiteConfig into a flat Helm values object.
 * The role field drives which chart components are enabled.
 */
export function siteConfigToHelmValues(config: SiteConfig): Record<string, string | boolean | number> {
  const role: InstallRole = config.role;
  const profile = RESOURCE_PROFILES[config.resources.profile];

  const values: Record<string, string | boolean | number> = {
    // Global
    "global.siteName": config.site.name,
    "global.domain": config.site.domain,
    "global.role": role,

    // dx-api (always enabled)
    "dx-api.enabled": true,
    "dx-api.mode": role,
    "dx-api.resources.requests.cpu": profile.apiCpu,
    "dx-api.resources.requests.memory": profile.apiMemory,

    // dx-reconciler (always enabled)
    "dx-reconciler.enabled": true,
    "dx-reconciler.resources.requests.cpu": profile.reconcilerCpu,
    "dx-reconciler.resources.requests.memory": profile.reconcilerMemory,

    // Traefik (always enabled)
    "traefik.enabled": true,

    // TLS
    "tls.mode": config.tls.mode,

    // Database
    "database.mode": config.database.mode,

    // Registry
    "registry.mode": config.registry.mode,

    // Network
    "network.podCidr": config.network.podCidr,
    "network.serviceCidr": config.network.serviceCidr,

    // Admin
    "admin.email": config.admin.email,

    // Factory-only components: disabled for site role
    "dx-builder.enabled": role === "factory",
    "fleet-plane.enabled": role === "factory",
    "commerce-plane.enabled": role === "factory",
    "product-plane.enabled": role === "factory",
    "observability.aggregation.enabled": role === "factory",
  };

  // Conditionals
  if (config.tls.certPath) values["tls.certPath"] = config.tls.certPath;
  if (config.tls.keyPath) values["tls.keyPath"] = config.tls.keyPath;
  if (config.database.mode === "external" && config.database.url) {
    values["database.url"] = config.database.url;
  }
  if (config.registry.mode === "external" && config.registry.url) {
    values["registry.url"] = config.registry.url;
  }

  return values;
}

/** Write Helm values to a flat --set format for CLI usage. */
export function helmValuesToSetArgs(values: Record<string, string | boolean | number>): string[] {
  return Object.entries(values).flatMap(([k, v]) => ["--set", `${k}=${v}`]);
}
