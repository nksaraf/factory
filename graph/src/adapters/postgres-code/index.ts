/**
 * postgres-code adapter — reads from typed Drizzle tables via a bindings
 * record. Used for framework + product entity kinds that have hand-written
 * Drizzle schemas (FACTORY_BINDINGS for the factory's own graph).
 *
 * Phase A: reads only. create/update/delete/link/unlink land in Phase B.
 */

import { Effect } from "effect"
import { eq, or } from "drizzle-orm"
import type { PgColumn, PgTable } from "drizzle-orm/pg-core"
import type { Adapter, InstanceRow, LinkRow, ListOpts, Ref } from "../types"

export interface Binding {
  readonly table: PgTable
  readonly slug: PgColumn
  readonly id: PgColumn
  readonly fks: Record<string, PgColumn>
}

interface Deps {
  readonly db: { select: (..._a: unknown[]) => any }
  readonly bindings: Record<string, Binding>
}

function toInstanceRow(
  kind: string,
  row: Record<string, unknown>
): InstanceRow {
  return {
    id: String(row.id),
    graphId: null,
    kind,
    slug: (row.slug as string | null) ?? null,
    title:
      (row.title as string | null) ?? (row.hostname as string | null) ?? null,
    spec: (row.spec ?? {}) as Record<string, unknown>,
    status: (row.status ?? null) as Record<string, unknown> | null,
    metadata: (row.metadata ?? null) as Record<string, unknown> | null,
    createdAt: (row.createdAt as Date) ?? new Date(0),
    updatedAt: (row.updatedAt as Date) ?? new Date(0),
  }
}

export function makePostgresCodeAdapter(deps: Deps): Adapter {
  const { db, bindings } = deps

  const unsupported = (op: string) =>
    Effect.fail(
      new Error(`postgres-code adapter does not support ${op} yet (Phase B)`)
    )

  return {
    name: "postgres-code",
    capabilities: { supportsWatch: false, supportsAggregate: false },

    get: (kind, idOrSlug) =>
      Effect.tryPromise(async () => {
        const b = bindings[kind]
        if (!b) return null
        const rows: Record<string, unknown>[] = await db
          .select()
          .from(b.table)
          .where(or(eq(b.id, idOrSlug), eq(b.slug, idOrSlug)))
          .limit(1)
        const r = rows[0]
        return r ? toInstanceRow(kind, r) : null
      }),

    list: (kind, opts: ListOpts) =>
      Effect.tryPromise(async () => {
        const b = bindings[kind]
        if (!b) return []
        let q: any = db.select().from(b.table)
        if (opts.limit) q = q.limit(opts.limit)
        if (opts.offset) q = q.offset(opts.offset)
        const rows: Record<string, unknown>[] = await q
        return rows.map((r) => toInstanceRow(kind, r))
      }),

    create: () => unsupported("create") as any,
    update: () => unsupported("update") as any,
    delete: () => unsupported("delete") as any,
    link: () => unsupported("link") as any,
    unlink: () => unsupported("unlink") as any,
    listLinks: (_src: Ref, _linkName: string) =>
      Effect.succeed([] as LinkRow[]),
  }
}
