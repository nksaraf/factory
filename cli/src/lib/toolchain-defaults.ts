/**
 * Toolchain defaults — the set of devDependencies every dx-managed repo
 * should have based on its tier. Enforced by the prelude so `dx check`,
 * `dx typecheck`, `dx lint`, `dx format` always have tools to run.
 *
 * These are the "agent readiness" baseline: linter, formatter, typechecker,
 * and task runner. Present-by-default, editable by the consumer if needed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export type DxTier = "system" | "product" | "marketing"

/** Map of devDep name → semver range string. */
export type DevDepSet = Record<string, string>

/**
 * Baseline devDeps every JS/TS dx project should have. The values here are
 * version ranges — specific enough to pin but loose enough to allow bumps.
 * Kept small and opinionated; consumers can override by declaring the same
 * package at a different version in their own devDependencies.
 */
const BASELINE: DevDepSet = {
  "@typescript/native-preview": "^7.0.0-dev.20260404.1", // tsgo (native TS compiler)
  oxlint: "^1.0.0", // linter
  oxfmt: "^0.2.0", // formatter (Prettier-compatible, 30x faster)
}

/**
 * Additional devDeps per-tier. Merged on top of BASELINE. Marketing sites
 * don't get turbo (single-app, no workspace).
 */
const PER_TIER: Record<DxTier, DevDepSet> = {
  system: { turbo: "^2.0.0" },
  product: { turbo: "^2.0.0" },
  marketing: {},
}

export function defaultsForTier(tier: DxTier | undefined): DevDepSet {
  if (!tier) return { ...BASELINE }
  return { ...BASELINE, ...PER_TIER[tier] }
}

export interface ToolchainEnsureResult {
  changed: boolean
  added: string[]
}

/**
 * Ensure the repo's package.json#devDependencies contains the tier's default
 * toolchain. If anything is missing, add it at the declared baseline version
 * and rewrite package.json. Returns `{changed, added}` so the caller can
 * invalidate the deps cache and re-run install.
 *
 * Never downgrades or reorders existing entries — only adds what's absent.
 * If the repo already pins a different version of a baseline package, that
 * pin wins (consumer override).
 */
export function ensureToolchainDefaults(
  rootDir: string
): ToolchainEnsureResult {
  const pkgPath = join(rootDir, "package.json")
  if (!existsSync(pkgPath)) return { changed: false, added: [] }

  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
  } catch {
    return { changed: false, added: [] }
  }

  const dx = (pkg.dx ?? {}) as Record<string, unknown>
  const tier =
    typeof dx.tier === "string" &&
    (dx.tier === "system" || dx.tier === "product" || dx.tier === "marketing")
      ? (dx.tier as DxTier)
      : undefined

  // Only enforce defaults on repos that opt-in via dx.tier. Package-only
  // repos without tier get no auto-install (conservative default).
  if (!tier) return { changed: false, added: [] }

  const defaults = defaultsForTier(tier)
  const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>
  const added: string[] = []

  for (const [name, version] of Object.entries(defaults)) {
    // Existing entry wins even if pinned differently — treat the consumer as
    // the source of truth for overrides.
    if (devDeps[name]) continue
    // Also skip if it's already in dependencies (runtime). Unusual but
    // possible for oxfmt etc. in some projects.
    const runtimeDeps = (pkg.dependencies ?? {}) as Record<string, string>
    if (runtimeDeps[name]) continue

    devDeps[name] = version
    added.push(name)
  }

  if (added.length === 0) return { changed: false, added: [] }

  pkg.devDependencies = sortDeps(devDeps)
  // Preserve trailing newline convention.
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n")
  return { changed: true, added }
}

/** Sort object keys alphabetically — matches `pnpm install`'s default ordering. */
function sortDeps(deps: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(deps).sort(([a], [b]) => a.localeCompare(b))
  )
}
