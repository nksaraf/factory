/**
 * Resolve system-level linked SDs from connection inputs.
 *
 * A "connect" value is `<slug>:<target-site>`. Slugs can refer to either a
 * component (`auth-api:workshop-staging`) or a whole system
 * (`shared-auth:workshop-staging`). This helper picks out the system-level
 * entries — those whose left slug matches a declared `catalog.spec.dependencies[].system`
 * — and returns the linked SDs the dev-orchestrator should write into
 * `.dx/site.json`.
 *
 * Naming convention for the local linked-SD slug and the remote SD slug is
 * a best-effort guess today (`<site>-<system>` for the remote SD, `<system>-linked`
 * for the local). Slice 6 replaces the remote-slug guess with a Factory API
 * lookup; the local slug stays this shape for UI stability.
 */
import type { CatalogSystem } from "@smp/factory-shared/catalog"
import {
  type EndpointMap,
  normalizeEnvMapping,
  resolveEnvMapping,
} from "./endpoint-resolver.js"

export interface LinkedSystemDeploymentResolution {
  /** Local SD slug in `.dx/site.json` (suffixed with `-linked` to differentiate). */
  slug: string
  /** The external system this linked SD represents. */
  systemSlug: string
  /** Where the linked SD points (site + remote SD). */
  linkedRef: { site: string; systemDeployment: string }
  /**
   * Env vars to inject into the focus SD's resolvedEnv — the concrete
   * endpoint values the focus's components need. Sourced from the dep's
   * `env:` field in `x-dx.dependencies[]`.
   */
  env: Record<string, string>
}

export interface ResolveLinkedSDsInputs {
  /** Parsed `--connect` list plus any auto-connects. Each entry: `<slug>:<site>`. */
  connects: readonly string[]
  /** Blanket `--connect-to <site>` value, if provided. */
  connectTo?: string
  /** The focus system's catalog — used to identify known dependency systems. */
  catalog: CatalogSystem
  /**
   * Per-system endpoint maps. Keyed by system slug. When present, enables
   * template interpolation in envMapping entries (component → host:port).
   * Today: not yet populated (Factory API endpoint discovery is future work).
   * The resolver falls back to envMapping fallback values when absent.
   */
  endpointsBySystem?: Record<string, EndpointMap>
}

/**
 * Return a LinkedSystemDeployment entry for every system-level target the
 * developer pointed at (explicit, auto-connect, or `--connect-to`). Entries
 * are deduped by systemSlug — if the same system was specified twice, the
 * first wins (usually the explicit flag, since `dev.ts` orders user entries
 * before auto-connects).
 *
 * Component-level `connect` entries (`api:workshop-staging`) are ignored
 * here — they're handled by the existing component-level `applyConnections`
 * path in the dev orchestrator.
 */
export function resolveLinkedSystemDeployments(
  inputs: ResolveLinkedSDsInputs
): LinkedSystemDeploymentResolution[] {
  const declaredDeps = inputs.catalog.spec.dependencies ?? []
  const knownSystems = new Set(declaredDeps.map((d) => d.system))
  if (knownSystems.size === 0) return []

  const seen = new Set<string>()
  const resolutions: LinkedSystemDeploymentResolution[] = []

  // Priority (from the plan's "Resolution priority" list):
  //   1. CLI `--connect <sys>:<target>` — per-system, highest
  //   2. CLI `--connect-to <site>`       — blanket fallback
  //   3. Profile `systems.<system>`      — (TODO slice 6)
  //   4. `x-dx.dependencies[].defaultTarget` (auto-connect, upstream in dev.ts)
  //
  // Iterate explicit --connect first; systems named there claim the `seen`
  // slot. Then the --connect-to blanket fills in whatever remains. This
  // matches mergeConnectionSources() ordering elsewhere where later args
  // lose to earlier claims.
  // Build per-system envMapping from each dep's env + envMapping fields.
  const depsBySlug = new Map(declaredDeps.map((d) => [d.system, d]))

  const resolveDepEnv = (slug: string): Record<string, string> => {
    const dep = depsBySlug.get(slug)
    if (!dep) return {}
    const mapping = normalizeEnvMapping(dep)
    if (Object.keys(mapping).length === 0) return {}
    return resolveEnvMapping({
      envMapping: mapping,
      endpoints: inputs.endpointsBySystem?.[slug],
    })
  }

  for (const entry of inputs.connects) {
    const colon = entry.indexOf(":")
    if (colon <= 0) continue
    const slug = entry.slice(0, colon)
    const site = entry.slice(colon + 1)
    if (!knownSystems.has(slug)) continue // component-level entry, not ours
    if (seen.has(slug)) continue
    seen.add(slug)
    resolutions.push(makeResolution(slug, site, resolveDepEnv(slug)))
  }

  if (inputs.connectTo) {
    for (const dep of declaredDeps) {
      if (seen.has(dep.system)) continue
      seen.add(dep.system)
      resolutions.push(
        makeResolution(dep.system, inputs.connectTo, resolveDepEnv(dep.system))
      )
    }
  }

  return resolutions
}

function makeResolution(
  systemSlug: string,
  targetSite: string,
  env?: Record<string, string>
): LinkedSystemDeploymentResolution {
  return {
    slug: `${systemSlug}-linked`,
    systemSlug,
    env: env ?? {},
    linkedRef: {
      site: targetSite,
      // Remote SD naming: conventional guess `<site>-<system>`. Slice 6
      // replaces this with a Factory API lookup against the actual
      // authoritative SD slug for the target site. Until then, this is
      // brittle — if the remote SD is named anything other than
      // `<site>-<system>` (e.g. `workshop-staging-auth` without the
      // `shared-` prefix), the linkedRef is wrong and any consumer that
      // dereferences it will fail. Known-broken is better than
      // silently-wrong: slice 6 is the fix.
      systemDeployment: `${targetSite}-${systemSlug}`,
    },
  }
}
