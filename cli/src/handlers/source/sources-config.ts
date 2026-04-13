/**
 * Read/write `package.json#dx.sources` — committed config for required source links.
 *
 * Each entry declares an external repo + subpath that should be checked out
 * locally as source code. `dx sync` restores these automatically.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export interface SourceEntry {
  /** GitHub shorthand (org/repo) or full git URL. */
  source: string
  /** Subdirectory within a monorepo. */
  path?: string
  /** Where to place the source in the workspace (relative to root). */
  target: string
  /** Branch or tag to track (defaults to repo default branch). */
  ref?: string
}

/**
 * Read all declared source dependencies from package.json#dx.sources.
 */
export function readSources(root: string): Record<string, SourceEntry> {
  const pkgPath = join(root, "package.json")
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
    return (pkg?.dx?.sources as Record<string, SourceEntry>) ?? {}
  } catch {
    return {}
  }
}

/**
 * Add or update a source dependency in package.json#dx.sources.
 */
export function writeSource(
  root: string,
  name: string,
  entry: SourceEntry
): void {
  const pkgPath = join(root, "package.json")
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))

  if (!pkg.dx) pkg.dx = {}
  if (!pkg.dx.sources) pkg.dx.sources = {}
  pkg.dx.sources[name] = entry

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n")
}

/**
 * Remove a source dependency from package.json#dx.sources.
 */
export function removeSource(root: string, name: string): void {
  const pkgPath = join(root, "package.json")
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))

  if (pkg?.dx?.sources?.[name]) {
    delete pkg.dx.sources[name]
    if (Object.keys(pkg.dx.sources).length === 0) {
      delete pkg.dx.sources
    }
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n")
  }
}
