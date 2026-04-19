/**
 * Resolve env vars from a system dependency's envMapping.
 *
 * Given an envMapping (from `x-dx.dependencies[].envMapping`) and an
 * optional endpoint source (cache, override), produces concrete env var
 * values ready for injection into the focus SD's resolvedEnv and the
 * spawned dev process environment.
 *
 * Resolution per entry:
 *   1. Endpoint source (cache/override) + template interpolation
 *   2. Fallback value (from envMapping entry)
 *   3. Empty string (entry declared but unresolvable)
 *
 * String entries (shorthand) bypass resolution entirely — they're
 * literal values, injected as-is.
 */
import type { EnvMappingEntry } from "@smp/factory-shared/catalog"

/**
 * Per-component endpoint info from a remote site. Populated by Factory API
 * endpoint discovery (future) or from override files (personal).
 */
export interface ComponentEndpoint {
  host: string
  port: number
  /** Additional named ports beyond the primary. Keyed by port name. */
  ports?: Record<string, number>
}

/**
 * All known endpoints for a linked system deployment — one entry per
 * component. Keyed by component slug.
 */
export type EndpointMap = Record<string, ComponentEndpoint>

export interface ResolveEnvMappingInputs {
  /** The envMapping from the dep (may contain string shortcuts + full objects). */
  envMapping: Record<string, EnvMappingEntry>
  /** Resolved endpoints for this linked system, if available. */
  endpoints?: EndpointMap
}

/**
 * Resolve an envMapping into concrete env var key-value pairs.
 *
 * Each entry is resolved independently. String entries are injected as-is.
 * Object entries attempt endpoint lookup + template interpolation; fall back
 * to the declared fallback; finally to empty string.
 */
export function resolveEnvMapping(
  inputs: ResolveEnvMappingInputs
): Record<string, string> {
  const result: Record<string, string> = {}

  for (const [envVar, entry] of Object.entries(inputs.envMapping)) {
    if (typeof entry === "string") {
      result[envVar] = entry
      continue
    }

    // Object entry: try endpoint resolution → template → fallback.
    const endpoint = inputs.endpoints?.[entry.component]
    if (endpoint) {
      const port = entry.port
        ? (endpoint.ports?.[entry.port] ?? endpoint.port)
        : endpoint.port
      result[envVar] = interpolateTemplate(entry.template, endpoint.host, port)
    } else if (entry.fallback) {
      result[envVar] = entry.fallback
    } else {
      // Unresolvable: no endpoint, no fallback. Set empty so the app
      // at least sees the env var exists (vs. undefined).
      result[envVar] = ""
    }
  }

  return result
}

/**
 * Interpolate `{host}` and `{port}` placeholders in a URL template.
 */
function interpolateTemplate(
  template: string,
  host: string,
  port: number
): string {
  return template.replace(/\{host\}/g, host).replace(/\{port\}/g, String(port))
}

/**
 * Normalize a dep's `env` (deprecated flat map) + `envMapping` (new form)
 * into a single envMapping. Called by the resolver to handle back-compat.
 *
 * If both `env` and `envMapping` exist, `envMapping` entries win per-key.
 */
export function normalizeEnvMapping(dep: {
  env?: Record<string, string>
  envMapping?: Record<string, EnvMappingEntry>
}): Record<string, EnvMappingEntry> {
  const result: Record<string, EnvMappingEntry> = {}
  // Legacy env: flat string values become shorthand entries.
  if (dep.env) {
    for (const [k, v] of Object.entries(dep.env)) {
      result[k] = v
    }
  }
  // envMapping entries win over env.
  if (dep.envMapping) {
    for (const [k, v] of Object.entries(dep.envMapping)) {
      result[k] = v
    }
  }
  return result
}
