/**
 * Auto-connect resolution for bare `dx dev`.
 *
 * Reads `catalog.spec.dependencies[]` (parsed from `x-dx.dependencies` in
 * docker-compose.yaml) and returns the connection wiring that bare `dx dev`
 * should apply when the developer didn't pass any `--connect-to` / `--connect`
 * / `--profile` flag.
 *
 * Resolution priority (highest wins):
 *   1. CLI `--connect <system>:<target>`  (handled upstream)
 *   2. CLI `--connect-to <site>`           (handled upstream; blanket)
 *   3. Profile `systems.<system>`          (handled upstream)
 *   4. `x-dx.dependencies[].defaultTarget` (this module)
 *   5. Binding fallback: required → error, optional → skip
 */
import type {
  CatalogSystem,
  CatalogSystemDependency,
} from "@smp/factory-shared/catalog"

export interface AutoConnectResult {
  /**
   * Synthesized CLI-equivalent entries: one string per auto-connected system,
   * formatted as `<system>:<target>` — suitable to pass as `--connect` flags.
   */
  autoConnects: string[]
  /**
   * Human-readable log lines describing each auto-connect decision. Printed
   * to stdout before the prelude runs so the developer can see what's
   * implicit.
   */
  logs: string[]
  /**
   * Warnings for non-fatal cases (optional dep with no target).
   */
  warnings: string[]
  /**
   * Errors for fatal cases (required dep with no target + no CLI override).
   * Empty array when everything resolved. Non-empty → dev startup should
   * fail with an actionable message.
   */
  errors: string[]
}

export interface AutoConnectInputs {
  catalog: CatalogSystem
  /**
   * Blanket flag: user passed `--connect-to <site>`. When true, auto-connect
   * is suppressed entirely — `--connect-to` explicitly says "everything
   * non-target is remote at THIS site," so defaultTargets are redundant.
   */
  hasConnectToFlag: boolean
  /**
   * Per-system coverage: systems already covered by an explicit `--connect`
   * flag or by a profile's `systems:` map. Auto-connect fills in the rest —
   * a developer can say `--connect shared-auth:my-laptop` and still have
   * `shared-queues` resolved from its declared defaultTarget.
   */
  coveredSystems: ReadonlySet<string>
}

/**
 * Resolve auto-connects from `catalog.spec.dependencies[]`, filling in only
 * systems NOT already covered by an explicit `--connect` or profile entry.
 * `--connect-to <site>` (blanket) bypasses auto-connect entirely.
 */
export function autoConnectsFromDeps(
  inputs: AutoConnectInputs
): AutoConnectResult {
  const result: AutoConnectResult = {
    autoConnects: [],
    logs: [],
    warnings: [],
    errors: [],
  }

  if (inputs.hasConnectToFlag) return result

  const deps = inputs.catalog.spec.dependencies ?? []
  if (deps.length === 0) return result

  for (const dep of deps) {
    // Per-system merge: an explicit --connect or profile entry for this
    // system already wins — no need to auto-connect it.
    if (inputs.coveredSystems.has(dep.system)) continue
    const entry = autoConnectForDep(dep)
    if (entry.autoConnect) result.autoConnects.push(entry.autoConnect)
    if (entry.log) result.logs.push(entry.log)
    if (entry.warning) result.warnings.push(entry.warning)
    if (entry.error) result.errors.push(entry.error)
  }

  return result
}

/**
 * Parse `--connect` CLI values (e.g. ["shared-auth:my-laptop", "redis:prod"])
 * into the set of system slugs they cover. Used by the caller to build
 * `coveredSystems` for `autoConnectsFromDeps`.
 */
export function coveredSystemsFromConnectFlags(
  connect: string | string[] | undefined
): Set<string> {
  const entries = !connect ? [] : Array.isArray(connect) ? connect : [connect]
  const covered = new Set<string>()
  for (const entry of entries) {
    const colon = entry.indexOf(":")
    if (colon > 0) covered.add(entry.slice(0, colon))
  }
  return covered
}

interface DepEntryResult {
  autoConnect?: string
  log?: string
  warning?: string
  error?: string
}

function autoConnectForDep(dep: CatalogSystemDependency): DepEntryResult {
  const system = dep.system
  const binding = dep.binding

  if (dep.defaultTarget) {
    return {
      autoConnect: `${system}:${dep.defaultTarget}`,
      log: `  · auto-connect: ${system} → ${dep.defaultTarget} (from x-dx.dependencies.defaultTarget)`,
    }
  }

  // No defaultTarget: behavior depends on binding.
  switch (binding) {
    case "required":
      return {
        error:
          `system "${system}" is required but has no defaultTarget and no CLI override.\n` +
          `  Either add \`defaultTarget: <site>\` under x-dx.dependencies for this system,\n` +
          `  or run with \`--connect ${system}:<site>\` / \`--connect-to <site>\`.`,
      }
    case "optional":
      return {
        warning: `optional system "${system}" has no target — skipped (env will be disabled)`,
      }
    case "dev-only":
      // dev-only with no target → also skip, silently (dev-only means "wire
      // when available in dev, otherwise ignore").
      return {}
  }
}
