/**
 * Network graph tracer.
 *
 * Walks networkLink edges from a starting entity, building the
 * full request path with protocol/port/TLS details at each hop.
 */

import { and, eq } from "drizzle-orm";

import type { Database } from "../../db/connection";
import { networkLink, substrate, host, runtime } from "../../db/schema/infra-v2";
import { NotFoundError } from "../../lib/errors";

// ── Reader interface (testable without DB) ───────────────────

interface LinkRow {
  id: string;
  slug: string;
  name: string;
  type: string;
  sourceKind: string;
  sourceId: string;
  targetKind: string;
  targetId: string;
  spec: Record<string, unknown>;
}

interface EntityRow {
  id: string;
  slug: string;
  name: string;
  type: string;
  [key: string]: unknown;
}

export interface GraphReader {
  findLinks(kind: string, id: string, direction: "outbound" | "inbound"): Promise<LinkRow[]>;
  findEntity(kind: string, id: string): Promise<EntityRow | null>;
}

export interface TraceHop {
  link: LinkRow;
  entity: EntityRow;
}

export interface TraceResult {
  origin: EntityRow;
  direction: "outbound" | "inbound";
  hops: TraceHop[];
}

const MAX_DEPTH = 20;

export async function traceFrom(
  reader: GraphReader,
  startKind: string,
  startId: string,
  direction: "outbound" | "inbound",
): Promise<TraceResult> {
  const origin = await reader.findEntity(startKind, startId);
  if (!origin) {
    throw new NotFoundError(`Entity not found: ${startKind}/${startId}`);
  }

  const visited = new Set<string>();
  visited.add(`${startKind}:${startId}`);

  const hops: TraceHop[] = [];
  let currentKind = startKind;
  let currentId = startId;

  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const links = await reader.findLinks(currentKind, currentId, direction);
    if (links.length === 0) break;

    // Follow the first link (primary path). Future: support branching.
    const link = links[0];
    const nextKind = direction === "outbound" ? link.targetKind : link.sourceKind;
    const nextId = direction === "outbound" ? link.targetId : link.sourceId;
    const key = `${nextKind}:${nextId}`;

    if (visited.has(key)) break; // cycle detection
    visited.add(key);

    const entity = await reader.findEntity(nextKind, nextId);
    if (!entity) break;

    hops.push({ link, entity });
    currentKind = nextKind;
    currentId = nextId;
  }

  return { origin, direction, hops };
}

// ── Drizzle implementation ───────────────────────────────────

const ENTITY_TABLES: Record<string, { table: any; idCol: any }> = {
  substrate: { table: substrate, idCol: substrate.id },
  host: { table: host, idCol: host.id },
  runtime: { table: runtime, idCol: runtime.id },
};

export function drizzleGraphReader(db: Database): GraphReader {
  return {
    async findLinks(kind, id, direction) {
      const condition =
        direction === "outbound"
          ? and(eq(networkLink.sourceKind, kind), eq(networkLink.sourceId, id))
          : and(eq(networkLink.targetKind, kind), eq(networkLink.targetId, id));

      const rows = await db.select().from(networkLink).where(condition);
      return rows as LinkRow[];
    },

    async findEntity(kind, id) {
      const meta = ENTITY_TABLES[kind];
      if (!meta) return null;
      const [row] = await db.select().from(meta.table).where(eq(meta.idCol, id));
      return (row as EntityRow) ?? null;
    },
  };
}

/**
 * Validate that source and target entities exist.
 * Accepts a GraphReader so it can be unit-tested without a real DB.
 */
export async function validateEndpointsWithReader(
  reader: GraphReader,
  parsed: { sourceKind?: string; sourceId?: string; targetKind?: string; targetId?: string },
): Promise<void> {
  if (parsed.sourceKind && parsed.sourceId) {
    const source = await reader.findEntity(parsed.sourceKind, parsed.sourceId);
    if (!source) {
      throw new NotFoundError(`Source entity not found: ${parsed.sourceKind}/${parsed.sourceId}`);
    }
  }

  if (parsed.targetKind && parsed.targetId) {
    const target = await reader.findEntity(parsed.targetKind, parsed.targetId);
    if (!target) {
      throw new NotFoundError(`Target entity not found: ${parsed.targetKind}/${parsed.targetId}`);
    }
  }
}

/**
 * Convenience wrapper for use in hooks — builds a DrizzleGraphReader internally.
 */
export async function validateEndpoints(
  db: Database,
  parsed: { sourceKind?: string; sourceId?: string; targetKind?: string; targetId?: string },
): Promise<void> {
  return validateEndpointsWithReader(drizzleGraphReader(db), parsed);
}
