import type { CatalogSystem } from "./catalog"
import type { NormalizedProfileEntry } from "./connection-context-schemas"
import { DependencyGraph } from "./dependency-graph"

// ── Types ─────────────────────────────────────────────────────

export interface ConnectionEndpoint {
  /** Docker service name, e.g., "infra-postgres" */
  dockerHostname: string
  /** Container port (inside Docker network), e.g., 5432 */
  containerPort: number
  /** Remote host, e.g., "192.168.2.88" */
  host: string
  /** Remote port, e.g., 54111 */
  port: number
  /** Compose interpolation overrides, e.g., { POSTGRES_USER: "postgres" } */
  vars: Record<string, string>
}

export interface DerivedOverride {
  /** Docker service name */
  service: string
  /** Env var overrides: varName → resolved value */
  overrides: Record<string, string>
  /** Warnings for things that couldn't be derived */
  warnings: string[]
}

// ── Endpoint construction ─────────────────────────────────────

/**
 * Build ConnectionEndpoint map from profile connect entries + catalog.
 * Only includes entries that have host and port defined.
 */
export function buildConnectionEndpoints(
  overrides: Record<string, NormalizedProfileEntry>,
  catalog: CatalogSystem
): Map<string, ConnectionEndpoint> {
  const endpoints = new Map<string, ConnectionEndpoint>()

  for (const [name, entry] of Object.entries(overrides)) {
    if (!entry.host || !entry.port) continue

    // Look up container port from catalog resource
    const resource = catalog.resources[name]
    const component = catalog.components[name]
    const entity = resource ?? component

    let containerPort = 0
    if (resource) {
      containerPort =
        resource.spec.containerPort ?? resource.spec.ports?.[0]?.port ?? 0
    } else if (component) {
      containerPort = component.spec.ports?.[0]?.port ?? 0
    }

    endpoints.set(name, {
      dockerHostname: name,
      containerPort,
      host: entry.host,
      port: entry.port,
      vars: entry.vars ?? {},
    })
  }

  return endpoints
}

// ── Transitive expansion ──────────────────────────────────────

/**
 * Expand explicitly-connected deps downward through the dependency graph.
 * If auth is connected and auth depends on postgres, postgres also becomes remote.
 *
 * Returns: all remote dep names (explicit + transitive).
 * Throws if a transitive dep has no endpoint info in the profile.
 */
export function expandRemoteDeps(
  explicitDeps: string[],
  graph: DependencyGraph,
  endpoints: Map<string, ConnectionEndpoint>,
  profileName: string
): string[] {
  const allRemote = new Set<string>()

  for (const dep of explicitDeps) {
    allRemote.add(dep)
    // Walk down: this dep's own dependencies must also be remote
    for (const transitive of graph.transitiveDeps(dep)) {
      if (!endpoints.has(transitive) && !allRemote.has(transitive)) {
        throw new Error(
          `${dep} depends on ${transitive}, but no endpoint (host/port) is defined ` +
            `for ${transitive} in profile '${profileName}'. ` +
            `Add host/port to the ${transitive} connect entry.`
        )
      }
      allRemote.add(transitive)
    }
  }

  return [...allRemote]
}

// ── Template resolution ───────────────────────────────────────

/**
 * Resolve a template string by substituting {host}, {port}, and {VAR} placeholders.
 *
 * For explicit labels (dx.dep templates):
 *   "{host}" → endpoint host
 *   "{port}" → endpoint port
 *   "{POSTGRES_USER}" → value from endpoint vars
 *
 * For auto-detected convention (raw compose env values):
 *   Replace Docker hostname with remote host
 *   Replace container port with remote port
 *   Resolve ${VAR:-default} compose interpolation using endpoint vars
 */
export function resolveTemplate(
  template: string,
  endpoint: ConnectionEndpoint,
  isExplicitLabel: boolean
): string {
  if (isExplicitLabel) {
    // dx.dep label templates use {placeholder} syntax
    return template.replace(/\{(\w+)\}/g, (_, key: string) => {
      if (key === "host") return endpoint.host
      if (key === "port") return String(endpoint.port)
      return endpoint.vars[key] ?? ""
    })
  }

  // Convention auto-detected: raw compose env value with Docker hostnames
  let result = template

  // Replace hostname:containerPort → host:port (do this before standalone hostname)
  if (endpoint.containerPort > 0) {
    result = result.replaceAll(
      `${endpoint.dockerHostname}:${endpoint.containerPort}`,
      `${endpoint.host}:${endpoint.port}`
    )
  }

  // Replace standalone hostname → host
  result = result.replaceAll(endpoint.dockerHostname, endpoint.host)

  // Replace standalone port values matching container port
  // Only if the entire value is just the port number
  if (result === String(endpoint.containerPort)) {
    result = String(endpoint.port)
  }

  // Resolve ${VAR:-default} compose interpolation using endpoint vars
  result = result.replace(
    /\$\{(\w+)(?::?[-+]([^}]*))?\}/g,
    (_, varName: string, fallback: string | undefined) => {
      return endpoint.vars[varName] ?? fallback ?? ""
    }
  )

  return result
}

// ── Main derivation ───────────────────────────────────────────

/**
 * Derive env var overrides for Docker services that depend on remote deps.
 *
 * Uses the catalog's depEnv (from dx.dep labels + convention auto-detection)
 * and resolves templates using the profile's connection endpoints.
 */
export function deriveServiceEnvOverrides(
  catalog: CatalogSystem,
  graph: DependencyGraph,
  allRemoteDeps: string[],
  endpoints: Map<string, ConnectionEndpoint>
): DerivedOverride[] {
  const remoteDepsSet = new Set(allRemoteDeps)
  const results: DerivedOverride[] = []

  // Check all services (components + resources) that are NOT themselves remote
  const allEntities: Array<
    [
      string,
      {
        spec: {
          dependsOn?: string[]
          depEnv?: Record<string, Record<string, string>>
        }
      },
    ]
  > = [
    ...Object.entries(catalog.components),
    ...Object.entries(catalog.resources),
  ]

  for (const [name, entity] of allEntities) {
    if (remoteDepsSet.has(name)) continue // skip remote deps themselves

    const deps = entity.spec.dependsOn ?? []
    const remoteDepsForService = deps.filter((d) => remoteDepsSet.has(d))
    if (remoteDepsForService.length === 0) continue

    const overrides: Record<string, string> = {}
    const warnings: string[] = []
    const depEnv = entity.spec.depEnv ?? {}

    for (const dep of remoteDepsForService) {
      const endpoint = endpoints.get(dep)
      if (!endpoint) continue

      const envMap = depEnv[dep]
      if (!envMap || Object.keys(envMap).length === 0) {
        warnings.push(
          `${name} depends on ${dep} but no connection env vars detected — ` +
            `check mounted config files or add dx.dep.${dep}.env.* labels`
        )
        continue
      }

      for (const [envKey, template] of Object.entries(envMap)) {
        // Explicit labels use {placeholder} syntax (no $ prefix).
        // Convention auto-detected templates use ${VAR:-default} or raw hostnames.
        const isExplicit = /(?<!\$)\{\w+\}/.test(template)
        overrides[envKey] = resolveTemplate(template, endpoint, isExplicit)

        // Warn about missing vars in explicit templates (e.g., {POSTGRES_PASSWORD} with no var)
        if (isExplicit) {
          const placeholders = template.match(/(?<!\$)\{(\w+)\}/g) ?? []
          for (const ph of placeholders) {
            const key = ph.slice(1, -1) // strip { }
            if (key !== "host" && key !== "port" && !(key in endpoint.vars)) {
              warnings.push(
                `${name}: ${envKey} references {${key}} but no value for ${key} in profile vars`
              )
            }
          }
        }
      }
    }

    if (Object.keys(overrides).length > 0 || warnings.length > 0) {
      results.push({ service: name, overrides, warnings })
    }
  }

  return results
}
