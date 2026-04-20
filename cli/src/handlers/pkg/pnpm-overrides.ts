/**
 * Manage pnpm.overrides in the root package.json.
 *
 * pnpm only honors `pnpm.overrides` at the workspace root, so we redirect
 * linked source packages there (rather than editing each dependent's
 * package.json). Overrides use pnpm's `link:` protocol so the dependent
 * resolves to the local checkout without requiring the target to be in
 * pnpm-workspace.yaml.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"

type PackageJson = {
  pnpm?: { overrides?: Record<string, string> } & Record<string, unknown>
} & Record<string, unknown>

function readRootPkg(root: string): { path: string; json: PackageJson } {
  const path = join(root, "package.json")
  const json = JSON.parse(readFileSync(path, "utf8")) as PackageJson
  return { path, json }
}

function writeRootPkg(path: string, json: PackageJson): void {
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n")
}

/** Read the `name` field from a package.json at the given directory. */
export function readPackageName(pkgDir: string): string | undefined {
  const pkgPath = join(pkgDir, "package.json")
  if (!existsSync(pkgPath)) return undefined
  try {
    const json = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string }
    return json.name
  } catch {
    return undefined
  }
}

/** Add (or replace) a `pnpm.overrides` entry mapping `name` → `link:<relPath>`. */
export function addPnpmOverride(
  root: string,
  name: string,
  relPath: string
): void {
  const { path, json } = readRootPkg(root)
  const pnpm = (json.pnpm ??= {})
  const overrides = (pnpm.overrides ??= {})
  overrides[name] = `link:./${relPath}`
  writeRootPkg(path, json)
}

/** Remove a `pnpm.overrides` entry. No-op if absent. */
export function removePnpmOverride(root: string, name: string): void {
  const { path, json } = readRootPkg(root)
  if (!json.pnpm?.overrides || !(name in json.pnpm.overrides)) return
  delete json.pnpm.overrides[name]
  writeRootPkg(path, json)
}
