import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { configDir, createStore } from "@crustjs/store";
import type { InstallRole } from "@smp/factory-shared/install-types";

const DX_CONFIG_DIR = configDir("dx");

/** Shared field definitions — used by both global and project-local stores. */
export const DX_CONFIG_FIELDS = {
  role: { type: "string", default: "workbench" },
  factoryUrl: { type: "string", default: "https://factory.rio.software" },
  siteUrl: { type: "string", default: "" },
  context: { type: "string", default: "" },
  authBasePath: { type: "string", default: "/api/v1/auth" },
  siteName: { type: "string", default: "" },
  domain: { type: "string", default: "" },
  adminEmail: { type: "string", default: "" },
  tlsMode: { type: "string", default: "self-signed" },
  tlsCertPath: { type: "string", default: "" },
  tlsKeyPath: { type: "string", default: "" },
  databaseMode: { type: "string", default: "embedded" },
  databaseUrl: { type: "string", default: "" },
  registryMode: { type: "string", default: "embedded" },
  registryUrl: { type: "string", default: "" },
  resourceProfile: { type: "string", default: "small" },
  networkPodCidr: { type: "string", default: "10.42.0.0/16" },
  networkServiceCidr: { type: "string", default: "10.43.0.0/16" },
  installMode: { type: "string", default: "connected" },
  /** Last successfully finished cluster install phase (1–6); "0" = none / finished. Used to resume after partial install. */
  installLastCompletedPhase: { type: "string", default: "0" },
} as const;

/** Global DX config store at ~/.config/dx/config.json. */
export const dxConfigStore = createStore({
  dirPath: DX_CONFIG_DIR,
  name: "config",
  fields: DX_CONFIG_FIELDS,
});

/** Type of the resolved config object. */
export type DxConfig = Awaited<ReturnType<typeof dxConfigStore.read>>;

/** Resolved path to the global config file. */
export function configPath(): string {
  return path.join(DX_CONFIG_DIR, "config.json");
}

/** Check if global config exists on disk. */
export function configExists(): boolean {
  return existsSync(configPath());
}

/** Find a project-local .dx/config.json by walking up from cwd. */
function findProjectConfigDir(): string | undefined {
  let dir = process.cwd();
  const root = path.parse(dir).root;
  while (dir !== root) {
    const candidate = path.join(dir, ".dx");
    if (existsSync(path.join(candidate, "config.json"))) {
      return candidate;
    }
    dir = path.dirname(dir);
  }
  return undefined;
}

/** Read merged config: project-local .dx/config.json > global > defaults. */
export async function readConfig(): Promise<DxConfig> {
  const global = await dxConfigStore.read();
  const localDir = findProjectConfigDir();
  if (!localDir) return global;

  const localStore = createStore({
    dirPath: localDir,
    name: "config",
    fields: DX_CONFIG_FIELDS,
  });
  const local = await localStore.read();

  const merged = { ...global };
  for (const [key, val] of Object.entries(local)) {
    if (typeof val === "string" && val.length > 0) {
      (merged as Record<string, string>)[key] = val;
    }
  }
  return merged;
}

/** Resolve the factory API URL from config. */
export function resolveFactoryUrl(config: DxConfig): string {
  return config.factoryUrl.replace(/\/$/, "");
}

/** Resolve the site API URL from config. Returns empty string if not set. */
export function resolveSiteUrl(config: DxConfig): string {
  return config.siteUrl.replace(/\/$/, "");
}

// --- Legacy compatibility shim ---

export interface LegacyDxConfig {
  apiUrl: string;
  authUrl: string;
  authBasePath: string;
  token?: string;
  defaultSite?: string;
  mode?: "factory" | "site" | "dev";
  siteUrl?: string;
}

/** @deprecated Use readConfig() instead. Sync shim for unmigrated callers. */
export function loadConfig(): LegacyDxConfig {
  const file = configPath();
  let parsed: Record<string, string> = {};
  try {
    const raw = readFileSync(file, "utf8");
    parsed = JSON.parse(raw);
  } catch {
    // No config file — use defaults
  }
  const factoryUrl = (parsed.factoryUrl || "https://factory.rio.software").replace(/\/$/, "");
  const role = parsed.role || "workbench";
  return {
    apiUrl: factoryUrl,
    authUrl: factoryUrl,
    authBasePath: parsed.authBasePath || "/api/v1/auth",
    token: undefined,
    defaultSite: parsed.siteName || undefined,
    mode: role === "factory" ? "factory" : role === "site" ? "site" : "dev",
    siteUrl: parsed.siteUrl || undefined,
  };
}

/** @deprecated Use dxConfigStore.write() instead. */
export function saveConfig(_config: LegacyDxConfig): void {
  // No-op during migration
}
