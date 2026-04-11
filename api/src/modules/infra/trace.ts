/**
 * Network graph tracer.
 *
 * Walks networkLink edges from a starting entity, building the
 * full request path with protocol/port/TLS details at each hop.
 */
import { and, eq } from "drizzle-orm"

import type { Database } from "../../db/connection"
import {
  dnsDomain,
  estate,
  host,
  ipAddress,
  networkLink,
  realm,
  route,
  service,
} from "../../db/schema/infra"
import { componentDeployment } from "../../db/schema/ops"
import { NotFoundError } from "../../lib/errors"

// ── Reader interface (testable without DB) ───────────────────

interface LinkRow {
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

interface EntityRow {
  id: string
  slug: string
  name: string
  type: string
  [key: string]: unknown
}

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
        ? (await reader.findEntity(link.viaKind, link.viaId)) ?? undefined
        : undefined

    hops.push({ link, via, entity })
    currentKind = nextKind
    currentId = nextId
  }

  return { origin, direction, hops }
}

// ── Drizzle implementation ───────────────────────────────────

const ENTITY_TABLES: Record<string, { table: any; idCol: any }> = {
  estate: { table: estate, idCol: estate.id },
  host: { table: host, idCol: host.id },
  realm: { table: realm, idCol: realm.id },
  service: { table: service, idCol: service.id },
  "ip-address": { table: ipAddress, idCol: ipAddress.id },
  "dns-domain": { table: dnsDomain, idCol: dnsDomain.id },
  route: { table: route, idCol: route.id },
  "component-deployment": {
    table: componentDeployment,
    idCol: componentDeployment.id,
  },
}

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
      return (row as EntityRow) ?? null
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
