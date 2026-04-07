import { existsSync } from "node:fs";
import { basename, join, dirname } from "node:path";
import type { CatalogComponent, CatalogResource, CatalogSystem } from "@smp/factory-shared/catalog";
import {
  discoverComposeFiles,
  findComposeRoot,
  type ComposeDiscoveryOptions,
} from "@smp/factory-shared/config-loader";
import { loadConventions } from "@smp/factory-shared/conventions";
import type { ConventionsConfig } from "@smp/factory-shared/conventions-schema";
import { DockerComposeFormatAdapter } from "@smp/factory-shared/formats/docker-compose.adapter";

import type { DetectedDatabase } from "./toolchain-detector.js";
import {
  loadDxProjectConfigOrDefaults,
  loadPackageScripts,
  loadPackageJson,
  type DxProjectConfig,
} from "./dx-project-config.js";

/**
 * ProjectContext — loads catalog, conventions, and config from a project root.
 *
 * This is an internal implementation detail used by `resolveDxContext()`.
 * Commands should use `resolveDxContext({ need: "project" })` instead of
 * constructing this directly.
 */
export class ProjectContext {
  readonly rootDir: string;
  readonly composeFiles: string[];
  readonly conventions: ConventionsConfig;
  readonly catalog: CatalogSystem;
  readonly dxConfig: DxProjectConfig;
  readonly scripts: Record<string, string>;
  readonly packageJson: Record<string, any> | null;

  private constructor(opts: {
    rootDir: string;
    composeFiles: string[];
    conventions: ConventionsConfig;
    catalog: CatalogSystem;
    dxConfig: DxProjectConfig;
    scripts: Record<string, string>;
    packageJson: Record<string, any> | null;
  }) {
    this.rootDir = opts.rootDir;
    this.composeFiles = opts.composeFiles;
    this.conventions = opts.conventions;
    this.catalog = opts.catalog;
    this.dxConfig = opts.dxConfig;
    this.scripts = opts.scripts;
    this.packageJson = opts.packageJson;
  }

  get systemName(): string {
    return this.catalog.metadata.name;
  }

  get owner(): string {
    // Prefer explicit dx team config, then catalog owner, then default
    const dxTeam = this.dxConfig.raw.team;
    const catalogOwner = this.catalog.spec.owner;
    if (typeof dxTeam === "string" && dxTeam) return dxTeam;
    if (catalogOwner && catalogOwner !== "unknown") return catalogOwner;
    return this.dxConfig.team; // falls back to default "local"
  }

  get componentNames(): string[] {
    return Object.keys(this.catalog.components);
  }

  get resourceNames(): string[] {
    return Object.keys(this.catalog.resources);
  }

  getComponent(name: string): CatalogComponent | undefined {
    return this.catalog.components[name];
  }

  getResource(name: string): CatalogResource | undefined {
    return this.catalog.resources[name];
  }

  /** Collect all unique profile names from components and resources. */
  get allProfiles(): string[] {
    const profiles = new Set<string>();
    for (const comp of Object.values(this.catalog.components)) {
      for (const p of comp.spec.profiles ?? []) profiles.add(p);
    }
    for (const res of Object.values(this.catalog.resources)) {
      for (const p of res.spec.profiles ?? []) profiles.add(p);
    }
    return [...profiles].sort();
  }

  /**
   * Load full project context from the current directory.
   * Requires docker-compose.yaml (catalog).
   */
  static fromCwd(cwd = process.cwd()): ProjectContext {
    // Load dx config first to get explicit compose file list
    const dxConfig = loadDxProjectConfigOrDefaults(cwd);
    const composeOpts = buildComposeDiscoveryOptions(dxConfig);

    const rootDir = findComposeRoot(cwd, composeOpts);
    if (!rootDir) {
      throw new Error(
        "No docker-compose file found (searched upward from the current directory).\n" +
        "Create a docker-compose.yaml or compose/ directory to define your project catalog."
      );
    }
    return ProjectContext.fromDir(rootDir);
  }

  /**
   * Load project context from an explicit directory.
   */
  static fromDir(rootDir: string): ProjectContext {
    const dxConfig = loadDxProjectConfigOrDefaults(rootDir);
    const composeOpts = buildComposeDiscoveryOptions(dxConfig);

    const composeFiles = discoverComposeFiles(rootDir, composeOpts);
    const adapter = new DockerComposeFormatAdapter();
    const { system: catalog } = adapter.parse(rootDir, { compose: composeOpts });
    const conventions = loadConventions(rootDir);
    const scripts = loadPackageScripts(rootDir);
    const packageJson = loadPackageJson(rootDir);

    return new ProjectContext({
      rootDir,
      composeFiles,
      conventions,
      catalog,
      dxConfig,
      scripts,
      packageJson,
    });
  }

  /**
   * Try to load project context without throwing.
   * Returns null if no docker-compose is found.
   */
  static tryFromCwd(cwd = process.cwd()): ProjectContext | null {
    try {
      return ProjectContext.fromCwd(cwd);
    } catch {
      return null;
    }
  }
}

/** Build ComposeDiscoveryOptions from dx config and environment. */
function buildComposeDiscoveryOptions(dxConfig: DxProjectConfig): ComposeDiscoveryOptions {
  const opts: ComposeDiscoveryOptions = {
    environment: process.env.DX_ENVIRONMENT ?? "local",
  };
  if (Array.isArray(dxConfig.raw.compose) && dxConfig.raw.compose.length > 0) {
    opts.explicitFiles = dxConfig.raw.compose;
  }
  return opts;
}

/** Extract database info from catalog resources (docker-compose labels). */
export function detectDatabaseFromCatalog(catalog: CatalogSystem): DetectedDatabase | null {
  for (const [name, resource] of Object.entries(catalog.resources)) {
    const type = resource.spec.type;
    if (type === "database") {
      const image = resource.spec.image ?? "";
      let engine: DetectedDatabase["engine"] | null = null;
      if (image.includes("postgres")) engine = "postgres";
      else if (image.includes("mysql") || image.includes("mariadb")) engine = "mysql";
      else if (image.includes("mongo")) engine = "mongo";

      if (engine) {
        const port = resource.spec.ports?.[0]?.port ?? (engine === "postgres" ? 5432 : engine === "mysql" ? 3306 : 27017);
        return { engine, service: name, port };
      }
    }
  }
  return null;
}
