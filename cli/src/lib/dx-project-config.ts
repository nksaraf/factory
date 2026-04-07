import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ─── Types ──────────────────────────────────────────────────

export type DxProjectType = "service" | "frontend" | "library" | "monorepo";
export type CommitConvention = "conventional" | "none";
export type BranchingModel = "trunk" | "gitflow";

export interface DxConventions {
  commits: CommitConvention;
  branching: BranchingModel;
}

export interface DxDeployConfig {
  preview?: {
    trigger: "pull-request" | "manual";
    ttl?: string;
  };
  production?: {
    trigger: "release-tag" | "manual";
    approval?: boolean;
  };
}

export interface DxProjectConfig {
  /** dx template version this project was scaffolded from */
  version: string;
  /** Project type */
  type: DxProjectType;
  /** Owning team slug */
  team: string;
  /** Convention settings */
  conventions: DxConventions;
  /** Deploy settings */
  deploy: DxDeployConfig;
  /** Raw dx key from package.json (for extension fields) */
  raw: Record<string, any>;
}

// ─── Defaults ───────────────────────────────────────────────

const DEFAULT_CONFIG: DxProjectConfig = {
  version: "0.0.0",
  type: "service",
  team: "local",
  conventions: {
    commits: "conventional",
    branching: "trunk",
  },
  deploy: {},
  raw: {},
};

// ─── Loader ─────────────────────────────────────────────────

/**
 * Read the `dx` key from `package.json` in the given directory
 * and return a typed DxProjectConfig with defaults for missing fields.
 */
export function loadDxProjectConfig(dir: string): DxProjectConfig | null {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return null;

  let pkg: Record<string, any>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    return null;
  }

  const dx = pkg.dx;
  if (!dx || typeof dx !== "object") return null;

  return {
    version: typeof dx.version === "string" ? dx.version : DEFAULT_CONFIG.version,
    type: isValidType(dx.type) ? dx.type : DEFAULT_CONFIG.type,
    team: typeof dx.team === "string" ? dx.team : DEFAULT_CONFIG.team,
    conventions: {
      commits: dx.conventions?.commits === "none" ? "none" : DEFAULT_CONFIG.conventions.commits,
      branching: dx.conventions?.branching === "gitflow" ? "gitflow" : DEFAULT_CONFIG.conventions.branching,
    },
    deploy: {
      preview: dx.deploy?.preview ?? DEFAULT_CONFIG.deploy.preview,
      production: dx.deploy?.production ?? DEFAULT_CONFIG.deploy.production,
    },
    raw: dx,
  };
}

/**
 * Load dx project config or return defaults if no dx key exists in package.json.
 * Use this when you need a config object regardless of whether it's explicitly set.
 */
export function loadDxProjectConfigOrDefaults(dir: string): DxProjectConfig {
  return loadDxProjectConfig(dir) ?? { ...DEFAULT_CONFIG, raw: {} };
}

/**
 * Read all scripts from package.json for pass-through support.
 */
export function loadPackageScripts(dir: string): Record<string, string> {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return {};
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

/**
 * Read the full package.json as an object.
 */
export function loadPackageJson(dir: string): Record<string, any> | null {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    return JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    return null;
  }
}

// ─── Helpers ────────────────────────────────────────────────

function isValidType(value: unknown): value is DxProjectType {
  return typeof value === "string" && ["service", "frontend", "library", "monorepo"].includes(value);
}
