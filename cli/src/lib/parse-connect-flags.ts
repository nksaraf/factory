import type { CatalogSystem } from "@smp/factory-shared/catalog"
import type { NormalizedProfileEntry } from "@smp/factory-shared/connection-context-schemas"

/**
 * Expand `--connect-to <target>` into overrides for all deps + connections.
 * Every resource and connection in the catalog gets pointed at the given target.
 */
export function parseConnectToFlag(
  target: string,
  catalog: CatalogSystem
): Record<string, NormalizedProfileEntry> {
  const result: Record<string, NormalizedProfileEntry> = {}
  for (const dep of Object.keys(catalog.resources)) {
    result[dep] = { target, readonly: false, backend: "direct" }
  }
  for (const conn of catalog.connections) {
    result[conn.name] = { target, readonly: false, backend: "direct" }
  }
  return result
}

/**
 * Parse `--connect dep:target` flag array into overrides.
 * Format: "dep:target" or "dep:target:backend"
 */
export function parseConnectFlags(
  flags: string[]
): Record<string, NormalizedProfileEntry> {
  const result: Record<string, NormalizedProfileEntry> = {}
  for (const flag of flags) {
    const parts = flag.split(":")
    if (parts.length < 2) {
      throw new Error(
        `Invalid --connect format: "${flag}". Expected "dep:target" or "dep:target:backend".`
      )
    }
    const [name, target, backend] = parts
    result[name!] = {
      target: target!,
      readonly: false,
      backend: (backend as NormalizedProfileEntry["backend"]) ?? "direct",
    }
  }
  return result
}

/**
 * Parse `--env KEY=VALUE` flag array into a flat map.
 */
export function parseEnvFlags(flags: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const flag of flags) {
    const eqIdx = flag.indexOf("=")
    if (eqIdx < 1) {
      throw new Error(`Invalid --env format: "${flag}". Expected "KEY=VALUE".`)
    }
    result[flag.slice(0, eqIdx)] = flag.slice(eqIdx + 1)
  }
  return result
}

/**
 * Merge connection sources by priority: profile < connect-to < selective connect.
 * Higher priority sources override lower ones per-key.
 */
export function mergeConnectionSources(
  profile?: Record<string, NormalizedProfileEntry>,
  connectTo?: Record<string, NormalizedProfileEntry>,
  connect?: Record<string, NormalizedProfileEntry>
): Record<string, NormalizedProfileEntry> {
  return {
    ...profile,
    ...connectTo,
    ...connect,
  }
}
