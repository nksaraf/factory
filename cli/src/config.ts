import path from "node:path";
import { existsSync } from "node:fs";
import { configDir, createStore } from "@crustjs/store";
import type { InstallRole } from "@smp/factory-shared/install-types";

const DX_CONFIG_DIR = configDir("dx");

/** Shared field definitions — used by both global and project-local stores. */
export const DX_CONFIG_FIELDS = {
  role: { type: "string", default: "workbench" },
  factoryUrl: { type: "string", default: "https://factory.lepton.software" },
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
  /** Factory run mode set by dx setup: "local" (embedded daemon), "dev" (docker-compose), "prod", or "" (unset). */
  factoryMode: { type: "string", default: "" },
  /** Path to kubeconfig file for the cluster (set during install, used by dx kube and internal commands). */
  kubeconfig: { type: "string", default: "" },
  /** Base directory for main repo checkouts (e.g., ~/conductor/repos). Auto-detected from Conductor layout if empty. */
  workspaceReposDir: { type: "string", default: "" },
  /** Base directory for worktree workspaces (e.g., ~/conductor/workspaces). Auto-detected from Conductor layout if empty. */
  workspaceWorktreesDir: { type: "string", default: "" },
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

/** The default local daemon URL used when factoryUrl is "local". */
export const LOCAL_FACTORY_URL = "http://localhost:4100";

/** Resolve the factory API URL from config (env DX_FACTORY_URL overrides). */
export function resolveFactoryUrl(config: DxConfig): string {
  const envUrl = process.env.DX_FACTORY_URL;
  const raw = envUrl ?? config.factoryUrl;
  if (raw === "local") return LOCAL_FACTORY_URL;
  return raw.replace(/\/$/, "");
}

/** Check if a URL points to localhost. */
export function isLocalFactoryUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

export type FactoryMode = "local" | "dev" | "cloud";

export interface FactoryModeInfo {
  mode: FactoryMode;
  url: string;
  /** Human-readable label for CLI display. */
  label: string;
  /** Whether DX_FACTORY_URL env var is overriding config. */
  envOverride: boolean;
}

/**
 * Determine factory mode from config + env.
 * "local" = embedded PGlite daemon + k3d (factoryUrl === "local").
 * "dev" = docker-compose factory + k3d (factoryUrl is localhost + factoryMode === "dev").
 * "cloud" = external factory instance.
 *
 * factoryMode is only trusted when consistent with factoryUrl:
 *   factoryMode "local"  requires factoryUrl === "local"
 *   factoryMode "dev"    requires factoryUrl pointing at localhost
 */
export function resolveFactoryMode(config: DxConfig): FactoryModeInfo {
  const envUrl = process.env.DX_FACTORY_URL;
  const url = resolveFactoryUrl(config);
  const raw = envUrl ?? config.factoryUrl;
  const urlIsLocal = isLocalFactoryUrl(url);

  // Dev mode: explicit factoryMode + localhost URL
  if (config.factoryMode === "dev" && urlIsLocal) {
    return { mode: "dev", url, label: "Dev (docker-compose)", envOverride: !!envUrl };
  }

  // Local mode: factoryUrl === "local" (canonical) or localhost without env override
  const isLocal = raw === "local" || (urlIsLocal && !envUrl);

  return {
    mode: isLocal ? "local" : "cloud",
    url,
    label: isLocal
      ? "Local (embedded)"
      : envUrl
        ? `${url} (via DX_FACTORY_URL)`
        : url,
    envOverride: !!envUrl,
  };
}

/** Resolve the site API URL from config. Returns empty string if not set. */
export function resolveSiteUrl(config: DxConfig): string {
  return config.siteUrl.replace(/\/$/, "");
}
