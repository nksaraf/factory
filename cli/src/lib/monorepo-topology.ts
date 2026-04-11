/**
 * Monorepo package discovery — finds and indexes all packages in a repo.
 *
 * Three ecosystems supported:
 *   npm     — pnpm-workspace.yaml → expand globs → read package.json
 *   python  — scan for pyproject.toml
 *   java    — parse parent pom.xml <modules>
 */
import { Glob } from "bun"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { basename, dirname, join, relative } from "node:path"
import { parse as parseYaml } from "yaml"

import {
  readMavenVersion,
  readNpmVersion,
  readPythonVersion,
} from "../handlers/pkg/versioning.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NpmManifest {
  raw: Record<string, unknown>
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  peerDependencies: Record<string, string>
  scripts: Record<string, string>
}

export interface PythonManifest {
  name: string | null
  version: string | null
  dependencies: string[]
  scripts: Record<string, string>
}

export interface MavenManifest {
  groupId: string | null
  artifactId: string | null
  version: string | null
  dependencies: Array<{ groupId: string; artifactId: string; version: string }>
}

export type PackageManifest = NpmManifest | PythonManifest | MavenManifest

export interface MonorepoPackage {
  name: string
  dir: string
  relativePath: string
  type: "npm" | "java" | "python"
  version: string | null
  manifest: PackageManifest
}

export interface MonorepoTopology {
  root: string
  packages: MonorepoPackage[]
  pnpmOverrides: Record<string, string>
}

// ---------------------------------------------------------------------------
// npm discovery
// ---------------------------------------------------------------------------

function readNpmManifest(pkgDir: string): NpmManifest | null {
  const p = join(pkgDir, "package.json")
  if (!existsSync(p)) return null
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"))
    return {
      raw,
      dependencies: raw.dependencies ?? {},
      devDependencies: raw.devDependencies ?? {},
      peerDependencies: raw.peerDependencies ?? {},
      scripts: raw.scripts ?? {},
    }
  } catch {
    return null
  }
}

function discoverNpmPackages(root: string): MonorepoPackage[] {
  const wsPath = join(root, "pnpm-workspace.yaml")
  if (!existsSync(wsPath)) return []

  let wsConfig: { packages?: string[] }
  try {
    wsConfig = parseYaml(readFileSync(wsPath, "utf8")) ?? {}
  } catch {
    return []
  }

  const patterns = wsConfig.packages ?? []
  const pkgs: MonorepoPackage[] = []
  const seen = new Set<string>()

  for (const pattern of patterns) {
    // skip negation patterns for now
    if (pattern.startsWith("!")) continue

    const glob = new Glob(pattern)
    const matches = glob.scanSync({ cwd: root, onlyFiles: false })
    for (const match of matches) {
      const dir = join(root, match)
      if (seen.has(dir)) continue
      if (!existsSync(join(dir, "package.json"))) continue
      seen.add(dir)

      const manifest = readNpmManifest(dir)
      if (!manifest) continue

      const { name, version } = readNpmVersion(dir)
      pkgs.push({
        name: name ?? basename(dir),
        dir,
        relativePath: relative(root, dir),
        type: "npm",
        version: version ?? null,
        manifest,
      })
    }
  }

  return pkgs
}

function readPnpmOverrides(root: string): Record<string, string> {
  const p = join(root, "package.json")
  if (!existsSync(p)) return {}
  try {
    const data = JSON.parse(readFileSync(p, "utf8"))
    return data.pnpm?.overrides ?? {}
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Python discovery
// ---------------------------------------------------------------------------

function readPyManifest(pkgDir: string): PythonManifest | null {
  const p = join(pkgDir, "pyproject.toml")
  if (!existsSync(p)) return null
  try {
    const text = readFileSync(p, "utf8")
    const nameMatch = text.match(/^\s*name\s*=\s*["']([^"']+)["']/m)
    const verMatch = text.match(/^\s*version\s*=\s*["']([^"']+)["']/m)

    // Extract dependencies from [project] dependencies array
    const deps: string[] = []
    const depsMatch = text.match(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m)
    if (depsMatch) {
      const entries = depsMatch[1].match(/["']([^"']+)["']/g)
      if (entries) {
        for (const e of entries) deps.push(e.replace(/["']/g, ""))
      }
    }

    // Extract scripts
    const scripts: Record<string, string> = {}
    const scriptsSection = text.match(
      /\[project\.scripts\]([\s\S]*?)(?=\n\[|$)/
    )
    if (scriptsSection) {
      const lines = scriptsSection[1].matchAll(
        /^\s*(\S+)\s*=\s*["']([^"']+)["']/gm
      )
      for (const m of lines) scripts[m[1]] = m[2]
    }

    return {
      name: nameMatch?.[1] ?? null,
      version: verMatch?.[1] ?? null,
      dependencies: deps,
      scripts,
    }
  } catch {
    return null
  }
}

function discoverPythonPackages(root: string): MonorepoPackage[] {
  const pkgs: MonorepoPackage[] = []

  // Scan common locations for pyproject.toml
  const searchDirs = [root]
  const packagesDir = join(root, "packages")
  if (existsSync(packagesDir)) {
    searchDirs.push(packagesDir)
    const pyDir = join(packagesDir, "python")
    if (existsSync(pyDir)) searchDirs.push(pyDir)
  }

  const seen = new Set<string>()

  for (const searchDir of searchDirs) {
    let entries: string[]
    try {
      entries = readdirSync(searchDir)
    } catch {
      continue
    }

    for (const entry of entries) {
      const dir = join(searchDir, entry)
      if (seen.has(dir)) continue
      try {
        if (!statSync(dir).isDirectory()) continue
      } catch {
        continue
      }

      if (!existsSync(join(dir, "pyproject.toml"))) continue
      // Skip if already discovered as npm package
      if (existsSync(join(dir, "package.json"))) continue

      seen.add(dir)
      const manifest = readPyManifest(dir)
      if (!manifest) continue

      const { name, version } = readPythonVersion(dir)
      pkgs.push({
        name: name ?? basename(dir),
        dir,
        relativePath: relative(root, dir),
        type: "python",
        version: version ?? null,
        manifest,
      })
    }
  }

  return pkgs
}

// ---------------------------------------------------------------------------
// Java discovery
// ---------------------------------------------------------------------------

function readMavenManifest(pkgDir: string): MavenManifest | null {
  const p = join(pkgDir, "pom.xml")
  if (!existsSync(p)) return null
  try {
    const text = readFileSync(p, "utf8")
    const noParent = text.replace(/<parent>[\s\S]*?<\/parent>/, "")
    const g = noParent.match(/<groupId>([^<]+)<\/groupId>/)
    const a = noParent.match(/<artifactId>([^<]+)<\/artifactId>/)
    const v = noParent.match(/<version>([^<]+)<\/version>/)

    // Parse <dependencies>
    const deps: Array<{
      groupId: string
      artifactId: string
      version: string
    }> = []
    const depsSection = text.match(/<dependencies>([\s\S]*?)<\/dependencies>/)
    if (depsSection) {
      const depBlocks = depsSection[1].matchAll(
        /<dependency>([\s\S]*?)<\/dependency>/g
      )
      for (const block of depBlocks) {
        const dg = block[1].match(/<groupId>([^<]+)<\/groupId>/)
        const da = block[1].match(/<artifactId>([^<]+)<\/artifactId>/)
        const dv = block[1].match(/<version>([^<]+)<\/version>/)
        if (dg && da) {
          deps.push({
            groupId: dg[1],
            artifactId: da[1],
            version: dv?.[1] ?? "",
          })
        }
      }
    }

    return {
      groupId: g?.[1] ?? null,
      artifactId: a?.[1] ?? null,
      version: v?.[1] ?? null,
      dependencies: deps,
    }
  } catch {
    return null
  }
}

function discoverJavaPackages(root: string): MonorepoPackage[] {
  const pkgs: MonorepoPackage[] = []

  // Look for parent pom with <modules>
  const parentPomDirs = [join(root, "packages", "java"), root]

  for (const parentDir of parentPomDirs) {
    const pomPath = join(parentDir, "pom.xml")
    if (!existsSync(pomPath)) continue

    let text: string
    try {
      text = readFileSync(pomPath, "utf8")
    } catch {
      continue
    }

    const modulesMatch = text.match(/<modules>([\s\S]*?)<\/modules>/)
    if (!modulesMatch) continue

    const modules = modulesMatch[1].matchAll(/<module>([^<]+)<\/module>/g)
    for (const m of modules) {
      const moduleName = m[1].trim()
      const moduleDir = join(parentDir, moduleName)
      if (!existsSync(moduleDir)) continue

      const manifest = readMavenManifest(moduleDir)
      if (!manifest) continue

      const { version } = readMavenVersion(moduleDir)
      const name =
        manifest.artifactId ??
        (manifest.groupId
          ? `${manifest.groupId}:${manifest.artifactId}`
          : basename(moduleDir))

      pkgs.push({
        name,
        dir: moduleDir,
        relativePath: relative(root, moduleDir),
        type: "java",
        version: version ?? null,
        manifest,
      })
    }
  }

  return pkgs
}

// ---------------------------------------------------------------------------
// MonorepoTopology builder
// ---------------------------------------------------------------------------

/**
 * Walk up from `cwd` to find the monorepo root, then discover all packages.
 *
 * Root is identified by pnpm-workspace.yaml or a parent pom.xml with <modules>.
 */
export function fromCwd(cwd?: string): MonorepoTopology {
  const start = cwd ?? process.cwd()
  const root = findMonorepoRoot(start)

  const npmPackages = discoverNpmPackages(root)
  const pythonPackages = discoverPythonPackages(root)
  const javaPackages = discoverJavaPackages(root)

  return {
    root,
    packages: [...npmPackages, ...pythonPackages, ...javaPackages],
    pnpmOverrides: readPnpmOverrides(root),
  }
}

function findMonorepoRoot(startDir: string): string {
  let dir = startDir
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir
    if (existsSync(join(dir, "pom.xml"))) {
      // Check if it's a parent pom with modules
      try {
        const text = readFileSync(join(dir, "pom.xml"), "utf8")
        if (text.includes("<modules>")) return dir
      } catch {
        /* continue */
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return startDir
}

/**
 * Filter packages by glob/name pattern.
 * Matches against package name or relative path.
 */
export function filterPackages(
  topology: MonorepoTopology,
  filter?: string
): MonorepoPackage[] {
  if (!filter) return topology.packages

  const glob = new Glob(filter)
  return topology.packages.filter(
    (pkg) => glob.match(pkg.name) || glob.match(pkg.relativePath)
  )
}
