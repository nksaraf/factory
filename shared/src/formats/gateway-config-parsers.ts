/**
 * Gateway config parsers — extract routing targets from APISIX, Traefik, etc.
 *
 * Each parser reads a gateway's config file (YAML) and returns the list of
 * upstream services it routes to. This feeds into the catalog as
 * `CatalogResource.spec.gatewayTargets`, making gateway→service connections
 * visible in dependency graphs and diagrams.
 *
 * To add a new gateway type:
 *   registerGatewayParser("kong", { imagePatterns: [/^kong/i], parse(content) { ... } })
 */
import { readFileSync } from "node:fs"
import { extname, resolve } from "node:path"
import { parse as parseYaml } from "yaml"

import type { GatewayTarget } from "../catalog"

// ── Parser interface + registry ──────────────────────────────

export interface GatewayConfigParser {
  /** Image name patterns this parser handles (matched against base image name) */
  readonly imagePatterns: RegExp[]
  /** Parse config file content and return routing targets */
  parse(content: string, filePath: string): GatewayTarget[]
}

const parsers = new Map<string, GatewayConfigParser>()

export function registerGatewayParser(
  name: string,
  parser: GatewayConfigParser
): void {
  parsers.set(name, parser)
}

/** Find a parser that handles the given Docker image. */
export function findParserForImage(image: string): GatewayConfigParser | null {
  const baseName = extractImageBaseName(image)
  for (const parser of parsers.values()) {
    for (const pattern of parser.imagePatterns) {
      if (pattern.test(baseName)) return parser
    }
  }
  return null
}

// ── Helpers ──────────────────────────────────────────────────

function extractImageBaseName(image: string): string {
  const parts = image.split("/")
  const last = parts[parts.length - 1] ?? image
  return last.split(":")[0] ?? last
}

/** Check if a container mount path looks like a config file (not a data volume). */
export function looksLikeConfigFile(containerPath: string): boolean {
  const ext = extname(containerPath).toLowerCase()
  return [".yaml", ".yml", ".toml", ".conf", ".json"].includes(ext)
}

/** Split a docker-compose volume string into host and container paths. */
export function parseVolumeParts(
  volume: string
): { hostPath: string; containerPath: string } | null {
  // Format: ./host/path:/container/path[:ro|rw]
  const parts = volume.split(":")

  if (parts.length < 2) return null

  const hostPath = parts[0]!
  const containerPath = parts[1]!

  // Skip named volumes (no path separator in source)
  if (!hostPath.includes("/") && !hostPath.startsWith(".")) return null

  return { hostPath, containerPath }
}

// ── High-level API ───────────────────────────────────────────

/**
 * Parse all config files mounted into a gateway service.
 * Returns deduplicated targets across all config files.
 */
export function parseGatewayConfigs(
  image: string,
  volumes: string[],
  rootDir: string,
  warnings?: string[]
): GatewayTarget[] {
  const parser = findParserForImage(image)
  if (!parser) return []

  const allTargets: GatewayTarget[] = []
  const seen = new Set<string>() // dedup by service:port

  for (const vol of volumes) {
    const parts = parseVolumeParts(vol)
    if (!parts) continue
    if (!looksLikeConfigFile(parts.containerPath)) continue

    const absPath = resolve(rootDir, parts.hostPath)
    try {
      const content = readFileSync(absPath, "utf-8")
      const targets = parser.parse(content, absPath)
      for (const t of targets) {
        const key = `${t.service}:${t.port}`
        if (seen.has(key)) continue
        seen.add(key)
        allTargets.push(t)
      }
    } catch {
      warnings?.push(`Could not read gateway config: ${absPath}`)
    }
  }

  return allTargets
}

// ── APISIX parser ────────────────────────────────────────────

registerGatewayParser("apisix", {
  imagePatterns: [/^apisix/i],
  parse(content: string): GatewayTarget[] {
    try {
      const doc = parseYaml(content)
      if (!doc || typeof doc !== "object") return []

      // Build upstream ID → targets map
      const upstreamMap = new Map<
        string,
        Array<{ service: string; port: number; weight: number }>
      >()

      const upstreams = Array.isArray(doc.upstreams) ? doc.upstreams : []
      for (const upstream of upstreams) {
        if (!upstream?.id || !upstream?.nodes) continue
        const nodes = parseApisixNodes(upstream.nodes)
        if (nodes.length > 0) {
          upstreamMap.set(String(upstream.id), nodes)
        }
      }

      // Build upstream ID → route paths map
      const routeMap = new Map<string, string[]>()
      const routes = Array.isArray(doc.routes) ? doc.routes : []
      for (const route of routes) {
        if (!route) continue
        const upstreamId = route.upstream_id ? String(route.upstream_id) : null
        const uri = route.uri ? String(route.uri) : null

        if (upstreamId && uri) {
          const paths = routeMap.get(upstreamId) ?? []
          paths.push(uri)
          routeMap.set(upstreamId, paths)
        }

        // Handle inline upstream on route (no upstream_id)
        if (!upstreamId && route.upstream?.nodes && uri) {
          const nodes = parseApisixNodes(route.upstream.nodes)
          for (const node of nodes) {
            const inlineId = `_inline_${uri}`
            upstreamMap.set(inlineId, [node])
            routeMap.set(inlineId, [uri])
          }
        }
      }

      // Merge: produce GatewayTarget[] with routes attached
      const targets: GatewayTarget[] = []
      for (const [upstreamId, nodes] of upstreamMap) {
        const routes = routeMap.get(upstreamId)
        for (const node of nodes) {
          targets.push({
            service: node.service,
            port: node.port,
            ...(routes?.length ? { routes } : {}),
            ...(node.weight !== 1 ? { weight: node.weight } : {}),
          })
        }
      }

      return targets
    } catch {
      return []
    }
  },
})

/** Parse APISIX nodes — either object `{host:port: weight}` or array `[{host, port, weight}]`. */
function parseApisixNodes(
  nodes: unknown
): Array<{ service: string; port: number; weight: number }> {
  const result: Array<{ service: string; port: number; weight: number }> = []

  if (nodes && typeof nodes === "object" && !Array.isArray(nodes)) {
    // Object form: { "infra-auth:3000": 1 }
    for (const [key, weight] of Object.entries(nodes)) {
      const [host, portStr] = key.split(":")
      if (host && portStr) {
        const port = parseInt(portStr, 10)
        if (!isNaN(port)) {
          result.push({ service: host, port, weight: Number(weight) || 1 })
        }
      }
    }
  } else if (Array.isArray(nodes)) {
    // Array form: [{ host: "infra-auth", port: 3000, weight: 1 }]
    for (const node of nodes) {
      if (node?.host && node?.port) {
        result.push({
          service: String(node.host),
          port: Number(node.port),
          weight: Number(node.weight) || 1,
        })
      }
    }
  }

  return result
}

// ── Traefik parser ───────────────────────────────────────────

registerGatewayParser("traefik", {
  imagePatterns: [/^traefik/i],
  parse(content: string): GatewayTarget[] {
    try {
      const doc = parseYaml(content)
      if (!doc || typeof doc !== "object") return []

      const http = doc.http
      if (!http || typeof http !== "object") return []

      // Build service name → targets map
      const serviceTargets = new Map<
        string,
        Array<{ service: string; port: number }>
      >()

      const services = http.services
      if (services && typeof services === "object") {
        for (const [svcName, svcConfig] of Object.entries(
          services as Record<string, unknown>
        )) {
          const cfg = svcConfig as Record<string, unknown> | null
          const lb = cfg?.loadBalancer as Record<string, unknown> | null
          const servers = lb?.servers
          if (!Array.isArray(servers)) continue

          const nodes: Array<{ service: string; port: number }> = []
          for (const server of servers) {
            const url = (server as Record<string, unknown>)?.url
            if (typeof url !== "string") continue
            const parsed = parseTraefikUrl(url)
            if (parsed) nodes.push(parsed)
          }
          if (nodes.length > 0) {
            serviceTargets.set(svcName, nodes)
          }
        }
      }

      // Build service name → route paths map from routers
      const routeMap = new Map<string, string[]>()
      const routers = http.routers
      if (routers && typeof routers === "object") {
        for (const routerConfig of Object.values(
          routers as Record<string, unknown>
        )) {
          const cfg = routerConfig as Record<string, unknown> | null
          const svcName = cfg?.service
          const rule = cfg?.rule
          if (typeof svcName !== "string" || typeof rule !== "string") continue

          const paths = extractTraefikPaths(rule)
          if (paths.length > 0) {
            const existing = routeMap.get(svcName) ?? []
            existing.push(...paths)
            routeMap.set(svcName, existing)
          }
        }
      }

      // Merge
      const targets: GatewayTarget[] = []
      for (const [svcName, nodes] of serviceTargets) {
        const routes = routeMap.get(svcName)
        for (const node of nodes) {
          targets.push({
            ...node,
            ...(routes?.length ? { routes } : {}),
          })
        }
      }

      return targets
    } catch {
      return []
    }
  },
})

/** Parse a Traefik server URL like "http://infra-gateway:8005" into service + port. */
function parseTraefikUrl(
  url: string
): { service: string; port: number } | null {
  try {
    const parsed = new URL(url)
    const port = parsed.port
      ? parseInt(parsed.port, 10)
      : parsed.protocol === "https:"
        ? 443
        : 80
    if (isNaN(port) || !parsed.hostname) return null
    return { service: parsed.hostname, port }
  } catch {
    return null
  }
}

/** Extract path patterns from a Traefik router rule string. */
function extractTraefikPaths(rule: string): string[] {
  const paths: string[] = []
  // Match PathPrefix(`/path`) or Path(`/path`)
  const regex = /(?:PathPrefix|Path)\s*\(\s*`([^`]+)`\s*\)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(rule)) !== null) {
    if (match[1]) paths.push(match[1])
  }
  return paths
}
