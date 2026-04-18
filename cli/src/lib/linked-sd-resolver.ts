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

export interface LinkedSystemDeploymentResolution {
  /** Local SD slug in `.dx/site.json` (suffixed with `-linked` to differentiate). */
  slug: string
  /** The external system this linked SD represents. */
  systemSlug: string
  /** Where the linked SD points (site + remote SD). */
  linkedRef: { site: string; systemDeployment: string }
}

export interface ResolveLinkedSDsInputs {
  /** Parsed `--connect` list plus any auto-connects. Each entry: `<slug>:<site>`. */
  connects: readonly string[]
  /** Blanket `--connect-to <site>` value, if provided. */
  connectTo?: string
  /** The focus system's catalog — used to identify known dependency systems. */
  catalog: CatalogSystem
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

  // Blanket --connect-to: every known system dep gets linked to that site.
  if (inputs.connectTo) {
    for (const dep of declaredDeps) {
      if (seen.has(dep.system)) continue
      seen.add(dep.system)
      resolutions.push(makeResolution(dep.system, inputs.connectTo))
    }
  }

  for (const entry of inputs.connects) {
    const colon = entry.indexOf(":")
    if (colon <= 0) continue
    const slug = entry.slice(0, colon)
    const site = entry.slice(colon + 1)
    if (!knownSystems.has(slug)) continue // component-level entry, not ours
    if (seen.has(slug)) continue
    seen.add(slug)
    resolutions.push(makeResolution(slug, site))
  }

  return resolutions
}

function makeResolution(
  systemSlug: string,
  targetSite: string
): LinkedSystemDeploymentResolution {
  return {
    slug: `${systemSlug}-linked`,
    systemSlug,
    linkedRef: {
      site: targetSite,
      // Remote SD naming: conventional guess until Factory API lookup lands
      // in slice 6. Most deployments name SDs `<site>-<system>`; for sites
      // that embed the system name already (workshop-staging-auth), the
      // convention degrades gracefully — consumers that care pass the exact
      // slug via `--profile` instead.
      systemDeployment: `${targetSite}-${systemSlug}`,
    },
  }
}
