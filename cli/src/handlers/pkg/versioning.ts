/**
 * Semver read/write/bump for npm, Python, and Maven manifests.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export type BumpKind = "major" | "minor" | "patch"

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

/** Return [scopedPackageName, version] from package.json. */
export function readNpmVersion(pkgDir: string): {
  name: string | null
  version: string | null
} {
  const p = join(pkgDir, "package.json")
  if (!existsSync(p)) return { name: null, version: null }
  try {
    const data = JSON.parse(readFileSync(p, "utf8"))
    const name = typeof data.name === "string" ? data.name : null
    const version = typeof data.version === "string" ? data.version : null
    return { name, version }
  } catch {
    return { name: null, version: null }
  }
}

/** Return [distributionName, version] from pyproject.toml. */
export function readPythonVersion(pkgDir: string): {
  name: string | null
  version: string | null
} {
  const p = join(pkgDir, "pyproject.toml")
  if (!existsSync(p)) return { name: null, version: null }
  try {
    const text = readFileSync(p, "utf8")
    const nameMatch = text.match(/^\s*name\s*=\s*["']([^"']+)["']/m)
    const verMatch = text.match(/^\s*version\s*=\s*["']([^"']+)["']/m)
    return {
      name: nameMatch?.[1] ?? null,
      version: verMatch?.[1] ?? null,
    }
  } catch {
    return { name: null, version: null }
  }
}

/** Return [groupId, artifactId, version] from pom.xml (project coords, not parent). */
export function readMavenVersion(pkgDir: string): {
  groupId: string | null
  artifactId: string | null
  version: string | null
} {
  const p = join(pkgDir, "pom.xml")
  if (!existsSync(p)) return { groupId: null, artifactId: null, version: null }
  try {
    const text = readFileSync(p, "utf8")
    // Remove <parent> block to avoid matching parent coords
    const noParent = text.replace(/<parent>[\s\S]*?<\/parent>/, "")
    const g = noParent.match(/<groupId>([^<]+)<\/groupId>/)
    const a = noParent.match(/<artifactId>([^<]+)<\/artifactId>/)
    const v = noParent.match(/<version>([^<]+)<\/version>/)
    return {
      groupId: g?.[1] ?? null,
      artifactId: a?.[1] ?? null,
      version: v?.[1] ?? null,
    }
  } catch {
    return { groupId: null, artifactId: null, version: null }
  }
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

export function writeNpmVersion(pkgDir: string, newVersion: string): void {
  const p = join(pkgDir, "package.json")
  const data = JSON.parse(readFileSync(p, "utf8"))
  data.version = newVersion
  writeFileSync(p, JSON.stringify(data, null, 2) + "\n")
}

export function writePythonVersion(pkgDir: string, newVersion: string): void {
  const p = join(pkgDir, "pyproject.toml")
  let text = readFileSync(p, "utf8")
  const newText = text.replace(
    /^(version\s*=\s*)["'][^"']+["']/m,
    `$1"${newVersion}"`
  )
  if (newText === text) {
    throw new Error("Could not find [project] version in pyproject.toml")
  }
  writeFileSync(p, newText)
}

export function writeMavenVersion(pkgDir: string, newVersion: string): void {
  const p = join(pkgDir, "pom.xml")
  let text = readFileSync(p, "utf8")
  const newText = text.replace(
    /(<artifactId>[^<]+<\/artifactId>\s*<version>)([^<]+)(<\/version>)/,
    `$1${newVersion}$3`
  )
  if (newText === text) {
    throw new Error(
      "Could not bump version in pom.xml (expected artifactId then version)"
    )
  }
  writeFileSync(p, newText)
}

// ---------------------------------------------------------------------------
// Bump
// ---------------------------------------------------------------------------

/** Bump X.Y.Z; preserves pre-release suffix. */
export function bumpSemver(version: string, kind: BumpKind): string {
  const m = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(.*)$/)
  if (!m) throw new Error(`Not a simple semver: ${version}`)

  let [, major, minor, patch] = m.map(Number)
  const rest = m[4]

  if (kind === "patch") patch++
  else if (kind === "minor") {
    minor++
    patch = 0
  } else {
    major++
    minor = 0
    patch = 0
  }

  return `${major}.${minor}.${patch}${rest}`
}

// ---------------------------------------------------------------------------
// Read version by type
// ---------------------------------------------------------------------------

export function readVersion(
  pkgDir: string,
  type: string
): { name: string | null; version: string | null } {
  if (type === "npm") return readNpmVersion(pkgDir)
  if (type === "python") return readPythonVersion(pkgDir)
  if (type === "java") {
    const { groupId, artifactId, version } = readMavenVersion(pkgDir)
    return {
      name: groupId && artifactId ? `${groupId}:${artifactId}` : null,
      version,
    }
  }
  return { name: null, version: null }
}

export function writeVersion(
  pkgDir: string,
  type: string,
  newVersion: string
): void {
  if (type === "npm") writeNpmVersion(pkgDir, newVersion)
  else if (type === "python") writePythonVersion(pkgDir, newVersion)
  else if (type === "java") writeMavenVersion(pkgDir, newVersion)
  else throw new Error(`Unknown package type: ${type}`)
}
