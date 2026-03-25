import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { parse, stringify } from "yaml";

export interface DxConfig {
  apiUrl: string;
  /** Better Auth service origin (no trailing path segment for base path). */
  authUrl: string;
  /** Path mounted on authUrl (e.g. /api/v1/auth). */
  authBasePath: string;
  /**
   * Optional API bearer (legacy). Prefer `~/.config/dx/session.json` from
   * `dx auth login`.
   */
  token?: string;
  defaultSite?: string;
  /** CLI operating mode: factory (control plane), site (agent), or dev (product developer). */
  mode?: "factory" | "site" | "dev";
  /** URL of the local site-agent API (used in site mode). */
  siteUrl?: string;
}

const CONFIG_DIR = path.join(homedir(), ".config", "dx");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.yaml");

const DEFAULTS: DxConfig = {
  apiUrl: "http://127.0.0.1:4100",
  authUrl: "http://127.0.0.1:8180",
  authBasePath: "/api/v1/auth",
};

export function configPath(): string {
  return CONFIG_PATH;
}

export function loadConfig(): DxConfig {
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULTS };
  }
  const raw = readFileSync(CONFIG_PATH, "utf8");
  const parsed = parse(raw) as Partial<DxConfig>;
  return { ...DEFAULTS, ...parsed };
}

export function saveConfig(config: DxConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, stringify(config), "utf8");
}
