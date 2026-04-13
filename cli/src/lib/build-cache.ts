/**
 * Git-based build cache for Docker services.
 *
 * For services with `build:` directives, compares the git tree hash of the
 * build context directory against a stored hash in `.dx/build-hashes.json`.
 * If the hash matches and the container image exists locally, the build is
 * skipped. Dirty (uncommitted) files in the build context always trigger a build.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import type { CatalogSystem } from "@smp/factory-shared/catalog"

interface BuildHashes {
  [serviceName: string]: {
    treeHash: string
    builtAt: string
  }
}

const CACHE_FILE = "build-hashes.json"

function readHashes(dxDir: string): BuildHashes {
  const path = join(dxDir, CACHE_FILE)
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return {}
  }
}

function writeHashes(dxDir: string, hashes: BuildHashes): void {
  writeFileSync(join(dxDir, CACHE_FILE), JSON.stringify(hashes, null, 2))
}

/** Get the git tree hash for a directory path (relative to repo root). */
function gitTreeHash(rootDir: string, contextPath: string): string | null {
  // Resolve relative context path (e.g. "./api-server" → "api-server")
  const rel = contextPath.replace(/^\.\//, "")
  const result = spawnSync("git", ["rev-parse", `HEAD:${rel}`], {
    cwd: rootDir,
    encoding: "utf8",
    timeout: 5_000,
  })
  if (result.status !== 0) return null
  return result.stdout.trim()
}

/** Check if there are uncommitted changes in a directory. */
function hasDirtyFiles(rootDir: string, contextPath: string): boolean {
  const rel = contextPath.replace(/^\.\//, "")
  const result = spawnSync("git", ["diff", "--quiet", "HEAD", "--", rel], {
    cwd: rootDir,
    timeout: 5_000,
  })
  // Exit 0 = clean, exit 1 = dirty
  if (result.status !== 0) return true

  // Also check for untracked files in the context
  const untracked = spawnSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", rel],
    { cwd: rootDir, encoding: "utf8", timeout: 5_000 }
  )
  return (untracked.stdout?.trim().length ?? 0) > 0
}

export interface BuildCheckResult {
  /** Services that need building (source changed or no cache). */
  needsBuild: string[]
  /** Services where the build can be skipped (hash matches). */
  cached: string[]
  /** Per-service details for display. */
  details: Record<string, { reason: "dirty" | "changed" | "new" | "cached" }>
}

/**
 * Check which Docker services need rebuilding based on source changes.
 * Only checks services that have `build:` directives in the catalog.
 */
export function checkBuildStatus(
  rootDir: string,
  catalog: CatalogSystem,
  services: string[]
): BuildCheckResult {
  const dxDir = join(rootDir, ".dx")
  const hashes = readHashes(dxDir)
  const result: BuildCheckResult = {
    needsBuild: [],
    cached: [],
    details: {},
  }

  for (const name of services) {
    // Find the build context — only components have build directives
    const comp = catalog.components[name]
    const buildContext = comp?.spec.build?.context
    if (!buildContext) continue // No build directive — pulled image, always skip

    // Check for dirty files first (uncommitted changes always trigger build)
    if (hasDirtyFiles(rootDir, buildContext)) {
      result.needsBuild.push(name)
      result.details[name] = { reason: "dirty" }
      continue
    }

    // Compare tree hash
    const currentHash = gitTreeHash(rootDir, buildContext)
    if (!currentHash) {
      result.needsBuild.push(name)
      result.details[name] = { reason: "new" }
      continue
    }

    const stored = hashes[name]
    if (stored && stored.treeHash === currentHash) {
      result.cached.push(name)
      result.details[name] = { reason: "cached" }
    } else {
      result.needsBuild.push(name)
      result.details[name] = { reason: stored ? "changed" : "new" }
    }
  }

  return result
}

/**
 * Record successful builds in the hash cache.
 */
export function recordBuild(
  rootDir: string,
  catalog: CatalogSystem,
  services: string[]
): void {
  const dxDir = join(rootDir, ".dx")
  const hashes = readHashes(dxDir)

  for (const name of services) {
    const comp = catalog.components[name]
    const buildContext = comp?.spec.build?.context
    if (!buildContext) continue

    const treeHash = gitTreeHash(rootDir, buildContext)
    if (treeHash) {
      hashes[name] = { treeHash, builtAt: new Date().toISOString() }
    }
  }

  writeHashes(dxDir, hashes)
}
