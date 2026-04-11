/**
 * dx pkg versions — show local vs latest version comparison.
 */

import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { run } from "../../lib/subprocess.js"
import { printTable } from "../../output.js"
import { readVersion } from "./versioning.js"

export interface VersionsOptions {
  target?: string
  verbose?: boolean
}

/** Fetch latest npm version via `npm view`. */
function fetchLatestNpm(
  pkgName: string,
  root: string,
  debug?: boolean
): string | null {
  const result = run("npm", ["view", pkgName, "version", "--json"], {
    cwd: root,
    timeout: 30_000,
  })
  if (result.status !== 0) {
    if (debug)
      console.warn(`npm view ${pkgName} version → exit ${result.status}`)
    return null
  }
  const out = result.stdout.trim().replace(/^"|"$/g, "")
  return out || null
}

/** Fetch latest Python version via `pip index versions`. */
function fetchLatestPip(
  pkgName: string,
  root: string,
  debug?: boolean
): string | null {
  const result = run("pip", ["index", "versions", pkgName], {
    cwd: root,
    timeout: 30_000,
  })
  if (result.status !== 0) {
    if (debug)
      console.warn(`pip index versions ${pkgName} → exit ${result.status}`)
    return null
  }
  // Parse: "pkg (1.0.0)\nAvailable versions: 1.0.0, 0.9.0"
  const avail = result.stdout.match(/Available versions:\s*(.+)/i)
  if (avail) {
    const versions = avail[1].split(",").map((v) => v.trim())
    return versions[0] || null
  }
  const paren = result.stdout.match(/\(([^)]+)\)/)
  return paren?.[1]?.trim() ?? null
}

export async function pkgVersions(
  root: string,
  opts: VersionsOptions
): Promise<void> {
  const rows: string[][] = []

  if (opts.target) {
    // Show specific package
    const info = resolvePackageDir(root, opts.target)
    if (!info) {
      throw new Error(`Package '${opts.target}' not found`)
    }
    const { name, version } = readVersion(info.dir, info.type)
    const latest = fetchLatest(name, info.type, root, opts.verbose)
    rows.push([info.type, name ?? opts.target, version ?? "-", latest ?? "-"])
  } else {
    // Show all packages
    for (const typeDir of ["npm", "java", "python"]) {
      const pkgsDir = join(root, "packages", typeDir)
      if (!existsSync(pkgsDir)) continue
      for (const entry of readdirSync(pkgsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const pkgDir = join(pkgsDir, entry.name)
        const { name, version } = readVersion(pkgDir, typeDir)
        if (!version) continue
        const latest = fetchLatest(name, typeDir, root, opts.verbose)
        rows.push([typeDir, name ?? entry.name, version, latest ?? "-"])
      }
    }
  }

  if (rows.length === 0) {
    console.log("No packages found")
    return
  }

  console.log(
    printTable(["Kind", "Name", "Local version", "Latest published"], rows)
  )
}

function fetchLatest(
  name: string | null,
  type: string,
  root: string,
  debug?: boolean
): string | null {
  if (!name) return null
  if (type === "npm") return fetchLatestNpm(name, root, debug)
  if (type === "python") return fetchLatestPip(name, root, debug)
  // Maven: would need gcloud or mvn — skip for now
  return null
}

function resolvePackageDir(
  root: string,
  target: string
): { dir: string; type: string } | null {
  for (const typeDir of ["npm", "java", "python"]) {
    const candidate = join(root, "packages", typeDir, target)
    if (existsSync(candidate)) return { dir: candidate, type: typeDir }
  }
  // Try direct path
  const candidate = join(root, target)
  if (existsSync(candidate)) {
    if (existsSync(join(candidate, "package.json")))
      return { dir: candidate, type: "npm" }
    if (existsSync(join(candidate, "pom.xml")))
      return { dir: candidate, type: "java" }
    if (existsSync(join(candidate, "pyproject.toml")))
      return { dir: candidate, type: "python" }
  }
  return null
}
