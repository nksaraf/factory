/**
 * postgres-dynamic adapter — reads customer-layer instances from the generic
 * JSONB tables in the `graph` schema (graph.instance, graph.link). Used for
 * entity kinds defined at runtime (customer layer) that don't have typed
 * Drizzle tables.
 *
 * Phase A: reads only. create/update/delete/link/unlink land in Phase B.
 */

import { Effect } from "effect"
import { and, eq, isNull, or } from "drizzle-orm"
import type { Adapter, InstanceRow, LinkRow, ListOpts, Ref } from "../types"

interface Deps {
  readonly db: { select: (..._a: unknown[]) => any }
  readonly tables: { readonly instance: any; readonly link: any }
}

function rowToInstance(r: Record<string, unknown>): InstanceRow {
  return {
    id: String(r.id),
    graphId: (r.graphId as string | null) ?? null,
    kind: String(r.kind),
    slug: (r.slug as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    spec: (r.spec ?? {}) as Record<string, unknown>,
    status: (r.status as Record<string, unknown> | null) ?? null,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
    createdAt: (r.createdAt as Date) ?? new Date(0),
    updatedAt: (r.updatedAt as Date) ?? new Date(0),
  }
}

export function makePostgresDynamicAdapter(deps: Deps): Adapter {
  const { db, tables } = deps
  const t = tables.instance
  const l = tables.link

  const unsupported = (op: string) =>
    Effect.fail(
      new Error(`postgres-dynamic adapter does not support ${op} yet (Phase B)`)
    )

  return {
    name: "postgres-dynamic",
    capabilities: { supportsWatch: false, supportsAggregate: false },

    get: (kind, idOrSlug, graphId) =>
      Effect.tryPromise(async () => {
        const rows: Record<string, unknown>[] = await db
          .select()
          .from(t)
          .where(
            and(
              eq(t.kind, kind),
              or(eq(t.id, idOrSlug), eq(t.slug, idOrSlug)),
              graphId ? eq(t.graphId, graphId) : isNull(t.graphId)
            )
          )
          .limit(1)
        return rows[0] ? rowToInstance(rows[0]) : null
      }),

    list: (kind, opts: ListOpts, graphId) =>
      Effect.tryPromise(async () => {
        let q: any = db
          .select()
          .from(t)
          .where(
            and(
              eq(t.kind, kind),
              graphId ? eq(t.graphId, graphId) : isNull(t.graphId)
            )
          )
        if (opts.limit) q = q.limit(opts.limit)
        if (opts.offset) q = q.offset(opts.offset)
        const rows: Record<string, unknown>[] = await q
        return rows.map(rowToInstance)
      }),

    create: () => unsupported("create") as any,
    update: () => unsupported("update") as any,
    delete: () => unsupported("delete") as any,
    link: () => unsupported("link") as any,
    unlink: () => unsupported("unlink") as any,

    listLinks: (src: Ref, linkName: string, graphId: string | null) =>
      Effect.tryPromise(async () => {
        const rows: Record<string, unknown>[] = await db
          .select()
          .from(l)
          .where(
            and(
              eq(l.sourceKind, src.kind),
              eq(l.sourceId, src.id),
              eq(l.linkTypeName, linkName),
              graphId ? eq(l.graphId, graphId) : isNull(l.graphId)
            )
          )
        return rows.map(
          (r): LinkRow => ({
            graphId: (r.graphId as string | null) ?? null,
            source: { kind: String(r.sourceKind), id: String(r.sourceId) },
            linkName: String(r.linkTypeName),
            target: { kind: String(r.targetKind), id: String(r.targetId) },
          })
        )
      }),
  }
}
