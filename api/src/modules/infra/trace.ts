/**
 * Network graph tracer.
 *
 * Two algorithms:
 * 1. `traceFrom` — legacy linear graph walk (backward compat)
 * 2. `traceRequest` — request-aware recursive trace that carries protocol/port/domain/path/headers,
 *    branches at load balancers, resolves host:port → entity implicitly, and looks up routes at
 *    reverse-proxy realms.
 */
import { and, eq, sql } from "drizzle-orm"

import type { Database } from "../../db/connection"
import {
  dnsDomain,
  estate,
  host,
  ipAddress,
  networkLink,
  realm,
  realmHost,
  route as routeTable,
  service,
} from "../../db/schema/infra"
import { componentDeployment } from "../../db/schema/ops"
import { component } from "../../db/schema/software"
import { NotFoundError } from "../../lib/errors"

// ── Common types ────────────────────────────────────────────

export interface LinkRow {
  id: string
  slug: string
  name: string
  type: string
  sourceKind: string
  sourceId: string
  viaKind?: string | null
  viaId?: string | null
  targetKind: string
  targetId: string
  spec: Record<string, unknown>
}

export interface EntityRow {
  id: string
  slug: string
  name: string
  type: string
  [key: string]: unknown
}

// ── Legacy reader interface ─────────────────────────────────

export interface GraphReader {
  findLinks(
    kind: string,
    id: string,
    direction: "outbound" | "inbound"
  ): Promise<LinkRow[]>
  findEntity(kind: string, id: string): Promise<EntityRow | null>
}

export interface TraceHop {
  link: LinkRow
  via?: EntityRow
  entity: EntityRow
}

export interface TraceResult {
  origin: EntityRow
  direction: "outbound" | "inbound"
  hops: TraceHop[]
}

// ── Request-aware trace types ───────────────────────────────

export type TraceProtocol = "http" | "https" | "tcp" | "udp" | "grpc"

export interface RequestContext {
  protocol: TraceProtocol
  port: number
  domain?: string
  path?: string
  headers?: Record<string, string>
}

export interface TraceNode {
  entity: EntityRow
  link?: LinkRow
  weight?: number
  implicit?: boolean
  children: TraceNode[]
}

export interface RequestTraceResult {
  request: RequestContext
  root: TraceNode
}

/** Resolved port → entity from host_listening_port view. */
export interface PortEntity {
  entity: EntityRow
  isGateway: boolean
}

/** Route matched on a reverse-proxy realm. */
export interface MatchedRoute {
  id: string
  slug: string
  name: string
  domain: string
  realmId: string | null
  spec: Record<string, unknown>
  priority: number
}

/** Extended reader for request-aware tracing. */
export interface RequestGraphReader extends GraphReader {
  findEntityOnPort(hostId: string, port: number): Promise<PortEntity | null>
  findRoutesOnRealm(
    realmId: string,
    request: RequestContext
  ): Promise<MatchedRoute[]>
  findHostForRealm(realmId: string): Promise<EntityRow | null>
  findComponentBySlug(slug: string): Promise<EntityRow | null>
}

const MAX_DEPTH = 20

export interface TraceOptions {
  /** Filter links by domain match (for reverse-proxy fan-out). */
  matchDomain?: string
}

/**
 * Match a domain against a pattern, supporting wildcard prefixes.
 * e.g. "*.agent.lepton.software" matches "foo.agent.lepton.software"
 */
export function domainMatches(pattern: string, domain: string): boolean {
  if (pattern === domain) return true
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1) // ".agent.lepton.software"
    return (
      domain.endsWith(suffix) && !domain.slice(0, -suffix.length).includes(".")
    )
  }
  return false
}

export async function traceFrom(
  reader: GraphReader,
  startKind: string,
  startId: string,
  direction: "outbound" | "inbound",
  options?: TraceOptions
): Promise<TraceResult> {
  const origin = await reader.findEntity(startKind, startId)
  if (!origin) {
    throw new NotFoundError(`Entity not found: ${startKind}/${startId}`)
  }

  const visited = new Set<string>()
  visited.add(`${startKind}:${startId}`)

  const hops: TraceHop[] = []
  let currentKind = startKind
  let currentId = startId

  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const links = await reader.findLinks(currentKind, currentId, direction)
    if (links.length === 0) break

    // Filter by domain when tracing a specific request path (e.g., reverse proxy has 100+ outbound links)
    let candidates = links
    if (options?.matchDomain) {
      const domainFiltered = links.filter((l) => {
        const hosts = (l.spec?.match as any)?.hosts as string[] | undefined
        return hosts?.some((h) => domainMatches(h, options.matchDomain!))
      })
      if (domainFiltered.length > 0) candidates = domainFiltered
    }

    const link = candidates[0]
    const nextKind =
      direction === "outbound" ? link.targetKind : link.sourceKind
    const nextId = direction === "outbound" ? link.targetId : link.sourceId
    const key = `${nextKind}:${nextId}`

    if (visited.has(key)) break // cycle detection
    visited.add(key)

    const entity = await reader.findEntity(nextKind, nextId)
    if (!entity) break

    const via =
      link.viaKind && link.viaId
        ? ((await reader.findEntity(link.viaKind, link.viaId)) ?? undefined)
        : undefined

    hops.push({ link, via, entity })
    currentKind = nextKind
    currentId = nextId
  }

  return { origin, direction, hops }
}

// ── Request-aware recursive tracer ─────────────────────────

/**
 * Parse a URL or domain string into a RequestContext.
 * Accepts: "https://bugs.rio.software:443/api/v1", "bugs.rio.software:443", "bugs.rio.software"
 */
export function parseRequestInput(input: string): RequestContext {
  // If it looks like a URL with a scheme
  if (input.includes("://")) {
    const url = new URL(input)
    const protocol = url.protocol.replace(":", "") as TraceProtocol
    const defaultPort =
      protocol === "https" ? 443 : protocol === "http" ? 80 : 0
    return {
      protocol,
      port: url.port ? parseInt(url.port, 10) : defaultPort,
      domain: url.hostname,
      path: url.pathname !== "/" ? url.pathname : undefined,
      headers: undefined,
    }
  }

  // "domain:port" or just "domain"
  const [domainPart, portStr] = input.split(":")
  const port = portStr ? parseInt(portStr, 10) : 443
  const protocol: TraceProtocol = port === 80 ? "http" : "https"

  return {
    protocol,
    port,
    domain: domainPart,
    path: undefined,
    headers: undefined,
  }
}

/**
 * Filter outbound links against a request context.
 * Returns all matching links, sorted by specificity (most specific first).
 */
export function filterByRequest(
  links: LinkRow[],
  request: RequestContext
): LinkRow[] {
  const scored: Array<{ link: LinkRow; score: number }> = []

  for (const link of links) {
    const spec = link.spec ?? {}
    const match = spec.match as
      | {
          hosts?: string[]
          pathPrefixes?: string[]
          headers?: Record<string, string>
          sni?: string[]
        }
      | undefined

    let score = 0

    // Port match
    const ingressPort = spec.ingressPort as number | undefined
    if (ingressPort && ingressPort !== request.port) continue
    if (ingressPort) score += 10

    // Domain match
    const matchHosts = match?.hosts ?? []
    if (matchHosts.length > 0 && request.domain) {
      const hostMatch = matchHosts.some((h) =>
        domainMatches(h as string, request.domain!)
      )
      if (!hostMatch) continue
      // Exact match scores higher than wildcard
      const exactMatch = matchHosts.includes(request.domain)
      score += exactMatch ? 100 : 50
    } else if (matchHosts.length > 0 && !request.domain) {
      // Link requires a domain but request doesn't have one — skip
      continue
    }
    // No hosts in match = catch-all, score stays low

    // Path match (longest prefix wins)
    const matchPaths = match?.pathPrefixes ?? []
    if (matchPaths.length > 0 && request.path) {
      const pathMatch = matchPaths
        .filter((p) => request.path!.startsWith(p as string))
        .sort((a, b) => (b as string).length - (a as string).length)
      if (pathMatch.length > 0) {
        score += 20 + (pathMatch[0] as string).length
      } else {
        continue // path doesn't match any prefix
      }
    }

    // Header match (all specified headers must match)
    const matchHeaders = match?.headers ?? {}
    if (Object.keys(matchHeaders).length > 0 && request.headers) {
      const allMatch = Object.entries(matchHeaders).every(
        ([k, v]) => request.headers![k] === v
      )
      if (!allMatch) continue
      score += 30
    }

    // SNI match (for TLS passthrough)
    const matchSni = match?.sni ?? []
    if (matchSni.length > 0 && request.domain) {
      if (!matchSni.some((s) => domainMatches(s as string, request.domain!)))
        continue
      score += 40
    }

    // Priority from link spec
    const priority = (spec.priority as number | undefined) ?? 0
    score += priority

    scored.push({ link, score })
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score)
  return scored.map((s) => s.link)
}

/**
 * Recursive request-aware tracer.
 * Carries request context through the graph, branching at load balancers,
 * resolving host:port → entity implicitly, and matching routes at reverse-proxy realms.
 */
export async function traceRequest(
  reader: RequestGraphReader,
  request: RequestContext,
  startKind: string,
  startId: string,
  depth = 0,
  visited: Set<string> = new Set()
): Promise<TraceNode> {
  const visitKey = `${startKind}:${startId}`

  if (depth >= MAX_DEPTH || visited.has(visitKey)) {
    const entity = await reader.findEntity(startKind, startId)
    return {
      entity: entity ?? {
        id: startId,
        slug: startId,
        name: startId,
        type: startKind,
      },
      children: [],
    }
  }

  visited.add(visitKey)

  const entity = await reader.findEntity(startKind, startId)
  if (!entity) {
    return {
      entity: { id: startId, slug: startId, name: startId, type: startKind },
      children: [],
    }
  }

  const node: TraceNode = { entity, children: [] }

  // Get outbound links from this entity
  const links = await reader.findLinks(startKind, startId, "outbound")
  const matched = filterByRequest(links, request)

  if (matched.length > 0) {
    // Normal link traversal — follow all matching links (branching)
    for (const link of matched) {
      const nextKind = link.targetKind
      const nextId = link.targetId
      const spec = link.spec ?? {}

      // Update request context from link
      const updatedRequest: RequestContext = {
        ...request,
        port: (spec.egressPort as number | undefined) ?? request.port,
        protocol:
          (spec.egressProtocol as TraceProtocol | undefined) ??
          request.protocol,
      }

      const child = await traceRequest(
        reader,
        updatedRequest,
        nextKind,
        nextId,
        depth + 1,
        visited
      )
      child.link = link
      child.weight =
        (spec.loadBalancing as { weight?: number } | undefined)?.weight ??
        undefined
      node.children.push(child)
    }
    return node
  }

  // No matching links — try implicit resolution

  // At a host: resolve port → entity
  if (startKind === "host") {
    const portEntity = await reader.findEntityOnPort(startId, request.port)
    if (portEntity) {
      if (portEntity.isGateway) {
        // Gateway (reverse proxy) — recurse into it
        const child = await traceRequest(
          reader,
          request,
          "realm",
          portEntity.entity.id,
          depth + 1,
          visited
        )
        child.implicit = true
        node.children.push(child)
      } else {
        // Terminal entity (component/service)
        node.children.push({
          entity: portEntity.entity,
          implicit: true,
          children: [],
        })
      }
    }
    return node
  }

  // At a reverse-proxy realm: look up routes matching the request.
  // Follow only the single best-matching route (most-specific wins).
  if (startKind === "realm" && entity.type === "reverse-proxy") {
    const routes = await reader.findRoutesOnRealm(startId, request)
    const best = routes[0]
    if (!best) return node

    const routeSpec = best.spec
    const targetPort =
      (routeSpec.targetPort as number | undefined) ?? request.port
    const updatedRequest: RequestContext = { ...request, port: targetPort }

    const routeEntity = (await reader.findEntity("route", best.id)) ?? {
      id: best.id,
      slug: best.slug,
      name: best.name,
      type: "route",
    }
    const routeNode: TraceNode = { entity: routeEntity, children: [] }

    // 1. Follow explicit outbound links from the route (if any).
    const routeLinks = await reader.findLinks("route", best.id, "outbound")
    for (const link of routeLinks) {
      const child = await traceRequest(
        reader,
        updatedRequest,
        link.targetKind,
        link.targetId,
        depth + 1,
        visited
      )
      child.link = link
      routeNode.children.push(child)
    }

    // 2. Otherwise try realm-level outbound links filtered by domain.
    if (routeNode.children.length === 0) {
      const realmLinks = await reader.findLinks("realm", startId, "outbound")
      const routeRequest: RequestContext = {
        ...updatedRequest,
        domain: best.domain !== "*" ? best.domain : request.domain,
      }
      const realmMatched = filterByRequest(realmLinks, routeRequest)
      for (const link of realmMatched) {
        const child = await traceRequest(
          reader,
          updatedRequest,
          link.targetKind,
          link.targetId,
          depth + 1,
          visited
        )
        child.link = link
        child.weight =
          (link.spec?.loadBalancing as { weight?: number } | undefined)
            ?.weight ?? undefined
        routeNode.children.push(child)
      }
    }

    // 3. Fall back to the route's resolvedTargets (populated by the scanner
    //    when the backend is a container on the same host — no explicit link
    //    exists but we know which component the proxy forwards to).
    if (routeNode.children.length === 0) {
      const status = (routeEntity.status ?? {}) as {
        resolvedTargets?: {
          componentSlug?: string
          systemDeploymentSlug?: string
          port?: number
          address?: string
        }[]
      }
      const seen = new Set<string>()
      for (const target of status.resolvedTargets ?? []) {
        const slug = target.componentSlug
        if (!slug || seen.has(slug)) continue
        seen.add(slug)
        const comp = await reader.findComponentBySlug(slug)
        if (!comp) continue
        // Synthesize a link so the renderer can show the forwarding port/address.
        const syntheticLink: LinkRow = {
          id: `synthetic-${best.id}-${slug}`,
          slug: `forward-${slug}`,
          name: `forward to ${slug}`,
          type: "forward",
          sourceKind: "route",
          sourceId: best.id,
          targetKind: "component",
          targetId: comp.id,
          spec: {
            egressPort: target.port,
            egressProtocol: "http",
            address: target.address,
          },
        }
        routeNode.children.push({
          entity: comp,
          children: [],
          link: syntheticLink,
        })
      }
    }

    // 4. Last resort: use the route's targetService/targetPort spec fields
    //    to search for a matching component by name fragment. This covers
    //    cases where the reconciler didn't populate resolvedTargets (e.g.,
    //    backends using host.docker.internal without host-port mappings).
    if (routeNode.children.length === 0 && routeSpec.targetService) {
      const svcName = (routeSpec.targetService as string)
        .replace(/@.*$/, "")
        .replace(/-service$/, "")
      if (svcName) {
        const comp = await reader.findComponentBySlug(svcName)
        if (comp) {
          const syntheticLink: LinkRow = {
            id: `synthetic-${best.id}-${svcName}`,
            slug: `forward-${svcName}`,
            name: `forward to ${svcName}`,
            type: "forward",
            sourceKind: "route",
            sourceId: best.id,
            targetKind: "component",
            targetId: comp.id,
            spec: {
              egressPort: routeSpec.targetPort ?? request.port,
              egressProtocol: "http",
            },
          }
          routeNode.children.push({
            entity: comp,
            children: [],
            link: syntheticLink,
          })
        }
      }
    }

    node.children.push(routeNode)
    return node
  }

  return node
}

// ── Drizzle implementation ───────────────────────────────────

const ENTITY_TABLES: Record<string, { table: any; idCol: any }> = {
  estate: { table: estate, idCol: estate.id },
  host: { table: host, idCol: host.id },
  realm: { table: realm, idCol: realm.id },
  service: { table: service, idCol: service.id },
  "ip-address": { table: ipAddress, idCol: ipAddress.id },
  "dns-domain": { table: dnsDomain, idCol: dnsDomain.id },
  route: { table: routeTable, idCol: routeTable.id },
  component: { table: component, idCol: component.id },
  "component-deployment": {
    table: componentDeployment,
    idCol: componentDeployment.id,
  },
}

/** Legacy reader — supports traceFrom only. */
export function drizzleGraphReader(db: Database): GraphReader {
  return {
    async findLinks(kind, id, direction) {
      const condition =
        direction === "outbound"
          ? and(eq(networkLink.sourceKind, kind), eq(networkLink.sourceId, id))
          : and(eq(networkLink.targetKind, kind), eq(networkLink.targetId, id))

      const rows = await db.select().from(networkLink).where(condition)
      return rows as LinkRow[]
    },

    async findEntity(kind, id) {
      const meta = ENTITY_TABLES[kind]
      if (!meta) return null
      const [row] = await db.select().from(meta.table).where(eq(meta.idCol, id))
      if (!row) return null
      const r = row as Record<string, unknown>
      // Normalize entity tables that lack slug/name (ip_address uses address, dns_domain uses fqdn)
      // Spread all columns so spec/fqdn/address etc. are available to the CLI for detail rendering
      return {
        ...r,
        id: r.id as string,
        slug: (r.slug ?? r.address ?? r.fqdn ?? r.id) as string,
        name: (r.name ?? r.address ?? r.fqdn ?? r.id) as string,
        type: (r.type ?? kind) as string,
      }
    },
  }
}

/** Full reader — supports traceRequest with port resolution and route matching. */
export function drizzleRequestGraphReader(db: Database): RequestGraphReader {
  const base = drizzleGraphReader(db)

  return {
    ...base,

    async findEntityOnPort(hostId, port) {
      // Query the host_listening_port view, preferring gateways
      const result = await db.execute(
        sql`SELECT entity_kind, entity_id, entity_slug, entity_type, is_gateway
            FROM infra.host_listening_port
            WHERE host_id = ${hostId} AND port = ${port}
            ORDER BY is_gateway DESC
            LIMIT 1`
      )

      // db.execute() may return rows directly (postgres-js) or as { rows: [...] } (drizzle wrapper)
      const rawRows = Array.isArray(result)
        ? result
        : ((result as any).rows ?? [])
      const rows = rawRows as Array<{
        entity_kind: string
        entity_id: string
        entity_slug: string
        entity_type: string
        is_gateway: boolean
      }>
      const row = rows[0]
      if (!row) return null

      const entity: EntityRow = {
        id: row.entity_id,
        slug: row.entity_slug,
        name: row.entity_slug,
        type: row.entity_type,
      }

      return { entity, isGateway: row.is_gateway }
    },

    async findRoutesOnRealm(realmId, request) {
      // Find routes on this realm, optionally filtering by domain
      const rows = await db
        .select({
          id: routeTable.id,
          slug: routeTable.slug,
          name: routeTable.name,
          domain: routeTable.domain,
          realmId: routeTable.realmId,
          spec: routeTable.spec,
        })
        .from(routeTable)
        .where(eq(routeTable.realmId, realmId))

      // Match routes against request context.
      // Request path defaults to "/" so path-prefix routes can match even when
      // the user traces a bare domain (e.g. https://trafficure.com).
      const requestPath = request.path ?? "/"
      const matched: MatchedRoute[] = []
      for (const r of rows) {
        const spec = (r.spec ?? {}) as Record<string, unknown>
        const routeDomain = r.domain
        const routePath = (spec.pathPrefix as string | undefined) ?? ""
        const routePriority = (spec.priority as number | undefined) ?? 0

        // Domain matching: exact, wildcard, or catch-all (*)
        let domainMatch = false
        if (!request.domain) {
          domainMatch = true // no domain filter = match all
        } else if (routeDomain === "*") {
          domainMatch = true // catch-all
        } else {
          domainMatch = domainMatches(routeDomain, request.domain)
        }

        if (!domainMatch) continue

        // Path matching: request path must start with the route's pathPrefix.
        // Empty pathPrefix matches anything.
        if (routePath && !requestPath.startsWith(routePath)) continue

        // Skip Traefik internal services (api@internal, dashboard@internal, etc.)
        const targetService = spec.targetService as string | undefined
        if (targetService?.includes("@internal")) continue

        matched.push({
          id: r.id,
          slug: r.slug,
          name: r.name,
          domain: r.domain,
          realmId: r.realmId,
          spec: spec,
          priority: routePriority,
        })
      }

      // Sort most-specific first: catch-all domains last, then by priority,
      // then by longest pathPrefix (so /api/v1/foo beats /api).
      matched.sort((a, b) => {
        if (a.domain === "*" && b.domain !== "*") return 1
        if (a.domain !== "*" && b.domain === "*") return -1
        if (b.priority !== a.priority) return b.priority - a.priority
        const aPath = (a.spec.pathPrefix as string | undefined) ?? ""
        const bPath = (b.spec.pathPrefix as string | undefined) ?? ""
        return bPath.length - aPath.length
      })

      return matched
    },

    async findHostForRealm(realmId) {
      const [row] = await db
        .select({
          id: host.id,
          slug: host.slug,
          name: host.name,
          type: host.type,
        })
        .from(host)
        .innerJoin(realmHost, eq(realmHost.hostId, host.id))
        .where(eq(realmHost.realmId, realmId))
        .limit(1)

      return (row as EntityRow) ?? null
    },

    async findComponentBySlug(slug) {
      // Exact match first
      const [exact] = await db
        .select()
        .from(component)
        .where(eq(component.slug, slug))
        .limit(1)
      if (exact) return exact as EntityRow

      // Contains match: "airflow" matches "traffic-airflow-airflow-webserver"
      // Prefer components whose type suggests a runnable service (not infra
      // like redis/postgres), then by name relevance (contains "-webserver",
      // "-app", "-api" etc.).
      const candidates = await db
        .select()
        .from(component)
        .where(sql`${component.slug} LIKE '%' || ${slug} || '%'`)
        .limit(10)

      if (candidates.length === 0) return null
      if (candidates.length === 1) return candidates[0] as EntityRow

      const INFRA_TYPES = /\b(redis|postgres|mongo|nats|zookeeper|kafka)\b/i
      const APP_SUFFIXES =
        /-(webserver|app|api|server|web|ui|frontend|backend)$/
      const scored = candidates.map((c) => {
        const s = (c as EntityRow).slug
        let score = 0
        if (INFRA_TYPES.test(s)) score -= 100
        if (APP_SUFFIXES.test(s)) score += 50
        if (s.endsWith(`-${slug}`)) score += 30
        if (s.includes(`-${slug}-`)) score += 20
        return { row: c, score }
      })
      scored.sort((a, b) => b.score - a.score)
      return scored[0].row as EntityRow
    },
  }
}

/**
 * Validate that source and target entities exist.
 * Accepts a GraphReader so it can be unit-tested without a real DB.
 */
export async function validateEndpointsWithReader(
  reader: GraphReader,
  parsed: {
    sourceKind?: string
    sourceId?: string
    targetKind?: string
    targetId?: string
  }
): Promise<void> {
  if (parsed.sourceKind && parsed.sourceId) {
    const source = await reader.findEntity(parsed.sourceKind, parsed.sourceId)
    if (!source) {
      throw new NotFoundError(
        `Source entity not found: ${parsed.sourceKind}/${parsed.sourceId}`
      )
    }
  }

  if (parsed.targetKind && parsed.targetId) {
    const target = await reader.findEntity(parsed.targetKind, parsed.targetId)
    if (!target) {
      throw new NotFoundError(
        `Target entity not found: ${parsed.targetKind}/${parsed.targetId}`
      )
    }
  }
}

/**
 * Convenience wrapper for use in hooks — builds a DrizzleGraphReader internally.
 */
export async function validateEndpoints(
  db: Database,
  parsed: {
    sourceKind?: string
    sourceId?: string
    targetKind?: string
    targetId?: string
  }
): Promise<void> {
  return validateEndpointsWithReader(drizzleGraphReader(db), parsed)
}
