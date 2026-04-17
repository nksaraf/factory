import { existsSync, readFileSync } from "node:fs"
import { basename, join, dirname } from "node:path"
import type {
  CatalogComponent,
  CatalogResource,
  CatalogSystem,
} from "@smp/factory-shared/catalog"
import {
  discoverComposeFiles,
  findComposeRoot,
  type ComposeDiscoveryOptions,
} from "@smp/factory-shared/config-loader"
import { loadConventions } from "@smp/factory-shared/conventions"
import type { ConventionsConfig } from "@smp/factory-shared/conventions-schema"
import { DockerComposeFormatAdapter } from "@smp/factory-shared/formats/docker-compose.adapter"

import type { DetectedDatabase } from "./toolchain-detector.js"
import {
  loadDxProjectConfigOrDefaults,
  loadPackageScripts,
  loadPackageJson,
  type DxProjectConfig,
} from "./dx-project-config.js"

/**
 * ProjectContext — loads catalog, conventions, and config from a project root.
 *
 * This is an internal implementation detail used by `resolveDxContext()`.
 * Commands should use `resolveDxContext({ need: "project" })` instead of
 * constructing this directly.
 */
export class ProjectContext {
  readonly rootDir: string
  readonly composeFiles: string[]
  readonly conventions: ConventionsConfig
  readonly catalog: CatalogSystem
  readonly dxConfig: DxProjectConfig
  readonly scripts: Record<string, string>
  readonly packageJson: Record<string, any> | null

  private constructor(opts: {
    rootDir: string
    composeFiles: string[]
    conventions: ConventionsConfig
    catalog: CatalogSystem
    dxConfig: DxProjectConfig
    scripts: Record<string, string>
    packageJson: Record<string, any> | null
  }) {
    this.rootDir = opts.rootDir
    this.composeFiles = opts.composeFiles
    this.conventions = opts.conventions
    this.catalog = opts.catalog
    this.dxConfig = opts.dxConfig
    this.scripts = opts.scripts
    this.packageJson = opts.packageJson
  }

  get systemName(): string {
    return this.catalog.metadata.name
  }

  get owner(): string {
    // Prefer explicit dx team config, then catalog owner, then default
    const dxTeam = this.dxConfig.raw.team
    const catalogOwner = this.catalog.spec.owner
    if (typeof dxTeam === "string" && dxTeam) return dxTeam
    if (catalogOwner && catalogOwner !== "unknown") return catalogOwner
    return this.dxConfig.team // falls back to default "local"
  }

  get componentNames(): string[] {
    return Object.keys(this.catalog.components)
  }

  get resourceNames(): string[] {
    return Object.keys(this.catalog.resources)
  }

  getComponent(name: string): CatalogComponent | undefined {
    return this.catalog.components[name]
  }

  getResource(name: string): CatalogResource | undefined {
    return this.catalog.resources[name]
  }

  /** Collect all unique profile names from components and resources. */
  get allProfiles(): string[] {
    const profiles = new Set<string>()
    for (const comp of Object.values(this.catalog.components)) {
      for (const p of comp.spec.profiles ?? []) profiles.add(p)
    }
    for (const res of Object.values(this.catalog.resources)) {
      for (const p of res.spec.profiles ?? []) profiles.add(p)
    }
    return [...profiles].sort()
  }

  /**
   * Load full project context from the current directory.
   * Requires docker-compose.yaml (catalog).
   */
  static fromCwd(cwd = process.cwd()): ProjectContext {
    // Load dx config first to get explicit compose file list
    const dxConfig = loadDxProjectConfigOrDefaults(cwd)
    const composeOpts = buildComposeDiscoveryOptions(dxConfig)

    const rootDir = findComposeRoot(cwd, composeOpts)
    if (!rootDir) {
      throw new Error(
        "No docker-compose file found (searched upward from the current directory).\n" +
          "Create a docker-compose.yaml or compose/ directory to define your project catalog."
      )
    }
    return ProjectContext.fromDir(rootDir)
  }

  /**
   * Load a "package-only" project — no compose file, just a package.json with
   * a `dx` block (e.g. `marketing-*` Astro/Next sites). Builds a synthetic
   * catalog with one component derived from `scripts.dev`.
   */
  static fromPackageJson(rootDir: string): ProjectContext {
    const dxConfig = loadDxProjectConfigOrDefaults(rootDir)
    const scripts = loadPackageScripts(rootDir)
    const packageJson = loadPackageJson(rootDir) ?? {}
    const conventions = loadConventions(rootDir)

    // Strip npm scope from the package name; fall back to the repo dir name
    // if the package is unnamed or the strip leaves nothing.
    const rawName =
      typeof packageJson.name === "string"
        ? String(packageJson.name).replace(/^@[^/]+\//, "")
        : ""
    const pkgName = rawName || basename(rootDir)

    // Prefer an explicit `dx.dev.command` override from package.json — this
    // is the escape hatch for frameworks like Astro that don't honour `PORT`
    // automatically, e.g. `"dx": { "dev": { "command": "pnpm run dev -- --port $PORT" } }`.
    // The spawn is via sh -c, so shell expansions ($PORT, $HOST, etc.) work.
    // Otherwise dispatch based on declared packageManager so a bun-managed
    // repo doesn't silently get shelled through pnpm.
    const dxBlock = (packageJson.dx ?? {}) as Record<string, unknown>
    const dxDev = (dxBlock.dev ?? {}) as Record<string, unknown>
    const overrideCommand =
      typeof dxDev.command === "string" && dxDev.command
        ? String(dxDev.command)
        : undefined
    const pm = detectPackageManager(packageJson)
    const devCommand =
      overrideCommand ??
      (typeof scripts.dev === "string" && scripts.dev
        ? `${pm} run dev`
        : undefined)

    // Owner: try package.json#author, then fall back to "unknown".
    const author = packageJson.author
    const owner =
      typeof author === "string" && author
        ? author
        : author &&
            typeof author === "object" &&
            typeof author.name === "string"
          ? author.name
          : "unknown"

    const components: CatalogSystem["components"] = {}
    if (devCommand) {
      components[pkgName] = {
        kind: "Component",
        metadata: { name: pkgName, namespace: "default" },
        spec: {
          type: "service",
          owner,
          lifecycle: "development",
          system: pkgName,
          dev: { command: devCommand, cwd: "." },
          profiles: [],
        },
      } as unknown as CatalogComponent
    }

    const catalog: CatalogSystem = {
      kind: "System",
      metadata: { name: pkgName, namespace: "default" },
      spec: { owner, lifecycle: "development" },
      components,
      resources: {},
      connections: [],
    }

    return new ProjectContext({
      rootDir,
      composeFiles: [],
      conventions,
      catalog,
      dxConfig,
      scripts,
      packageJson,
    })
  }

  /**
   * Load project context from an explicit directory.
   */
  static fromDir(rootDir: string): ProjectContext {
    const dxConfig = loadDxProjectConfigOrDefaults(rootDir)
    const composeOpts = buildComposeDiscoveryOptions(dxConfig)

    const composeFiles = discoverComposeFiles(rootDir, composeOpts)
    const adapter = new DockerComposeFormatAdapter()
    const { system: catalog } = adapter.parse(rootDir, { compose: composeOpts })
    const conventions = loadConventions(rootDir)
    const scripts = loadPackageScripts(rootDir)
    const packageJson = loadPackageJson(rootDir)

    return new ProjectContext({
      rootDir,
      composeFiles,
      conventions,
      catalog,
      dxConfig,
      scripts,
      packageJson,
    })
  }

  /**
   * Try to load project context without throwing.
   * Returns null if no docker-compose is found.
   */
  static tryFromCwd(cwd = process.cwd()): ProjectContext | null {
    try {
      return ProjectContext.fromCwd(cwd)
    } catch {
      return null
    }
  }
}

/**
 * Walk up from `cwd` looking for a dx project root. A directory qualifies if
 * it has either:
 *   - a docker-compose file (existing convention, compose-rooted projects), OR
 *   - a `package.json` with a `dx` block (package-only projects such as
 *     `marketing-*` sites where forcing a compose stub is overkill).
 *
 * Closest-wins: we walk up ONCE and return the first directory that matches
 * either condition. If a single directory has both a compose file AND a
 * `dx` block in package.json, compose wins (existing catalog convention).
 * This avoids the trap where a marketing sub-app nested inside a compose
 * monorepo would resolve to the outer compose root instead of the inner app.
 */
export function findProjectRoot(
  cwd: string,
  composeOpts?: ComposeDiscoveryOptions
): { rootDir: string; mode: "compose" | "package" } | null {
  let dir = cwd
  for (;;) {
    if (hasComposeFilesAt(dir, composeOpts)) {
      return { rootDir: dir, mode: "compose" }
    }
    if (hasDxPackageAt(dir)) {
      return { rootDir: dir, mode: "package" }
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Does this single directory have a compose file we consider a project root? */
function hasComposeFilesAt(
  dir: string,
  composeOpts?: ComposeDiscoveryOptions
): boolean {
  // Reuse findComposeRoot but scoped: if it returns exactly `dir`, this dir
  // is a compose root. Any farther match means no compose here.
  const found = findComposeRoot(dir, composeOpts)
  return found === dir
}

/**
 * Pick the right package-manager CLI name for `<pm> run dev`, based on the
 * repo's declared `packageManager` field (PEP 3.0 / corepack convention).
 * Defaults to `pnpm` since that's the ecosystem default.
 */
export function detectPackageManager(
  packageJson: Record<string, unknown>
): "pnpm" | "bun" | "yarn" | "npm" {
  const pm = packageJson.packageManager
  if (typeof pm === "string") {
    // Format: "name@version[+sha]"; we only care about the name prefix.
    const name = pm.split("@")[0]?.toLowerCase()
    if (
      name === "pnpm" ||
      name === "bun" ||
      name === "yarn" ||
      name === "npm"
    ) {
      return name
    }
  }
  return "pnpm"
}

/** Does this single directory have a package.json with a valid `dx` block? */
function hasDxPackageAt(dir: string): boolean {
  const pkgPath = join(dir, "package.json")
  if (!existsSync(pkgPath)) return false
  let raw: string
  try {
    raw = readFileSync(pkgPath, "utf-8")
  } catch {
    return false
  }
  let pkg: unknown
  try {
    pkg = JSON.parse(raw)
  } catch (err) {
    // Malformed package.json is a developer-visible bug worth surfacing.
    console.warn(
      `  ! malformed package.json at ${pkgPath}: ${err instanceof Error ? err.message : String(err)}`
    )
    return false
  }
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) return false
  const dx = (pkg as Record<string, unknown>).dx
  return (
    !!dx && typeof dx === "object" && !Array.isArray(dx) // reject `"dx": []`
  )
}

/** Build ComposeDiscoveryOptions from dx config and environment. */
function buildComposeDiscoveryOptions(
  dxConfig: DxProjectConfig
): ComposeDiscoveryOptions {
  const opts: ComposeDiscoveryOptions = {
    environment: process.env.DX_ENVIRONMENT ?? "local",
  }
  if (Array.isArray(dxConfig.raw.compose) && dxConfig.raw.compose.length > 0) {
    opts.explicitFiles = dxConfig.raw.compose
  }
  return opts
}

/** Extract database info from catalog resources (docker-compose labels). */
export function detectDatabaseFromCatalog(
  catalog: CatalogSystem
): DetectedDatabase | null {
  for (const [name, resource] of Object.entries(catalog.resources)) {
    const type = resource.spec.type
    if (type === "database") {
      const image = resource.spec.image ?? ""
      let engine: DetectedDatabase["engine"] | null = null
      if (image.includes("postgres")) engine = "postgres"
      else if (image.includes("mysql") || image.includes("mariadb"))
        engine = "mysql"
      else if (image.includes("mongo")) engine = "mongo"

      if (engine) {
        const port =
          resource.spec.ports?.[0]?.port ??
          (engine === "postgres" ? 5432 : engine === "mysql" ? 3306 : 27017)
        return { engine, service: name, port }
      }
    }
  }
  return null
}
