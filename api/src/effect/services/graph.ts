/**
 * Graph service — strongly typed entity access + parent hierarchy.
 *
 * The graph IR (from @smp/graph-dx-factory) defines the entity graph and
 * link relationships. FACTORY_BINDINGS (from ../../db/bindings) maps each
 * entity kind to its Drizzle table + columns. Together they replace ENTITY_MAP.
 *
 *   const graph = yield* Graph
 *   const est = yield* graph.estate.get("my-estate")
 *   const chain = yield* graph.ancestors("component-deployment", "api-prod")
 *   //=> [componentDeployment, systemDeployment, site, component, system, org]
 */

import { Context, Effect } from "effect"
import { type InferSelectModel, type SQL, eq, or } from "drizzle-orm"
import type { PgColumn, PgTable } from "drizzle-orm/pg-core"
import { EntityNotFoundError } from "@smp/factory-shared/effect/errors"

import { query, type DatabaseError } from "../layers/database"
import { isPrefixedId } from "../../lib/resolvers"
import type { Database } from "../../db/connection"
import { FACTORY_BINDINGS } from "../../db/bindings"

// ---------------------------------------------------------------------------
// Entity accessor — what each graph.X returns
// ---------------------------------------------------------------------------

export interface EntityAccessor<T extends PgTable> {
  readonly get: (
    slugOrId: string
  ) => Effect.Effect<InferSelectModel<T>, DatabaseError | EntityNotFoundError>

  readonly find: (
    slugOrId: string
  ) => Effect.Effect<InferSelectModel<T> | null, DatabaseError>

  readonly list: (opts?: {
    filter?: SQL
    limit?: number
    offset?: number
  }) => Effect.Effect<InferSelectModel<T>[], DatabaseError>
}

export function makeEntityAccessor<T extends PgTable>(
  db: Database,
  kind: string,
  table: T,
  slugColumn: PgColumn,
  idColumn: PgColumn
): EntityAccessor<T> {
  const resolve = (slugOrId: string) =>
    Effect.map(
      query(
        db
          .select()
          .from(table as PgTable)
          .where(or(eq(slugColumn, slugOrId), eq(idColumn, slugOrId)))
          .limit(2) as unknown as Promise<InferSelectModel<T>[]>
      ),
      (rows): InferSelectModel<T> | null => {
        if (rows.length === 0) return null
        if (rows.length === 1) return rows[0]
        const looksLikeId = isPrefixedId(slugOrId)
        const col = looksLikeId ? idColumn.name : slugColumn.name
        return (
          rows.find((r) => (r as Record<string, unknown>)[col] === slugOrId) ??
          rows[0]
        )
      }
    )

  return {
    get: (slugOrId) =>
      Effect.flatMap(resolve(slugOrId), (row) =>
        row === null
          ? Effect.fail(
              new EntityNotFoundError({ entity: kind, identifier: slugOrId })
            )
          : Effect.succeed(row)
      ),
    find: resolve,
    list: (opts) =>
      query(
        (() => {
          let q = db.select().from(table as PgTable) as any
          if (opts?.filter) q = q.where(opts.filter)
          if (opts?.limit) q = q.limit(opts.limit)
          if (opts?.offset) q = q.offset(opts.offset)
          return q as Promise<InferSelectModel<T>[]>
        })()
      ),
  }
}

// ---------------------------------------------------------------------------
// Ancestor reference — an entity in the ancestry chain
// ---------------------------------------------------------------------------

export interface AncestorRef {
  readonly kind: string
  readonly id: string
  readonly slug: string
  readonly entity: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Derived types — GraphService from FACTORY_BINDINGS
// ---------------------------------------------------------------------------

type Bindings = typeof FACTORY_BINDINGS

/**
 * The key mapping from FACTORY_BINDINGS uses hyphenated kind strings as keys
 * for some entities (e.g., "system-deployment"). To provide camelCase property
 * accessors on GraphService, we need to map the binding keys to accessor
 * names. The binding file uses the camelCase JS-identifier form for most
 * entities, with the exception of hyphenated keys for multi-word entity kinds.
 *
 * Since bindings already use JS-identifier keys (e.g., "system-deployment"),
 * the service exposes them as-is. Callers use graph["system-deployment"]
 * or graph.estate, etc.
 */
export type GraphService = {
  readonly [K in keyof Bindings]: EntityAccessor<Bindings[K]["table"]>
} & {
  /** Dynamic access by kind string. */
  readonly get: (
    kind: string,
    slugOrId: string
  ) => Effect.Effect<
    Record<string, unknown>,
    DatabaseError | EntityNotFoundError
  >

  readonly find: (
    kind: string,
    slugOrId: string
  ) => Effect.Effect<Record<string, unknown> | null, DatabaseError>

  /**
   * Walk the parent chain for an entity, returning ancestors in precedence
   * order (most specific first, org-level implicit last).
   *
   * For entities with dual lineage (e.g., systemDeployment has both site
   * and system parents), both lineages are walked breadth-first.
   *
   * Parent links are derived from the graph IR: any link with
   * cardinality === "many-to-one" is treated as a parent link. The FK
   * column is resolved from the binding's fks record.
   */
  readonly ancestors: (
    kind: string,
    slugOrId: string
  ) => Effect.Effect<AncestorRef[], DatabaseError | EntityNotFoundError>

  /**
   * Build the secret scope chain for an entity — the ordered list of
   * (scopeType, scopeId) pairs for secret resolution, from most specific
   * to least specific (org last).
   */
  readonly secretScopeChain: (
    kind: string,
    slugOrId: string
  ) => Effect.Effect<
    Array<{ scopeType: string; scopeId: string }>,
    DatabaseError | EntityNotFoundError
  >
}

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class Graph extends Context.Tag("Graph")<Graph, GraphService>() {}
