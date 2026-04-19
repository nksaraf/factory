/**
 * Ontology service — strongly typed entity access by kind.
 *
 * Provides domain-typed accessors derived from the Drizzle schema:
 *
 *   const est = yield* ontology.estate.get("my-estate")   // typed as InferSelectModel<typeof estate>
 *   const teams = yield* ontology.team.list()              // typed as InferSelectModel<typeof team>[]
 *
 * Each accessor provides:
 *   - `get(slugOrId)` — returns typed row or EntityNotFoundError
 *   - `find(slugOrId)` — returns typed row or null
 *   - `list(opts?)` — returns typed rows with optional filter/limit
 *
 * Also provides dynamic `get(kind, slugOrId)` for runtime-determined kinds
 * (e.g., inventory reconciler, CLI commands) using ONTOLOGY_REGISTRY.
 */

import { Context, Effect } from "effect"
import { type InferSelectModel, type SQL, eq, or } from "drizzle-orm"
import type { PgColumn, PgTable } from "drizzle-orm/pg-core"
import { EntityNotFoundError } from "@smp/factory-shared/effect/errors"

import { query, type DatabaseError } from "../layers/database"
import { isPrefixedId } from "../../lib/resolvers"
import type { Database } from "../../db/connection"

// ---------------------------------------------------------------------------
// Entity accessor — the typed interface each `ontology.estate` etc. returns
// ---------------------------------------------------------------------------

export interface EntityAccessor<T extends PgTable> {
  /** Get by slug or ID. Fails with EntityNotFoundError if not found. */
  readonly get: (
    slugOrId: string
  ) => Effect.Effect<InferSelectModel<T>, DatabaseError | EntityNotFoundError>

  /** Get by slug or ID, returns null if not found (no error). */
  readonly find: (
    slugOrId: string
  ) => Effect.Effect<InferSelectModel<T> | null, DatabaseError>

  /** List with optional filter. */
  readonly list: (opts?: {
    filter?: SQL
    limit?: number
    offset?: number
  }) => Effect.Effect<InferSelectModel<T>[], DatabaseError>
}

// ---------------------------------------------------------------------------
// Accessor factory — builds a typed accessor from a Drizzle table
// ---------------------------------------------------------------------------

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
// Import all slug-based ontology tables
// ---------------------------------------------------------------------------

import {
  estate,
  host,
  realm,
  service,
  route,
  dnsDomain,
  networkLink,
} from "../../db/schema/infra"
import {
  system,
  component,
  softwareApi,
  template,
  product,
  capability,
} from "../../db/schema/software"
import { team, principal, agent } from "../../db/schema/org"
import { site, systemDeployment, workbench } from "../../db/schema/ops"
import { repo, gitHostProvider } from "../../db/schema/build"

// ---------------------------------------------------------------------------
// Full typed service interface
// ---------------------------------------------------------------------------

export interface OntologyService {
  // Infra
  readonly estate: EntityAccessor<typeof estate>
  readonly host: EntityAccessor<typeof host>
  readonly realm: EntityAccessor<typeof realm>
  readonly service: EntityAccessor<typeof service>
  readonly route: EntityAccessor<typeof route>
  readonly dnsDomain: EntityAccessor<typeof dnsDomain>
  readonly networkLink: EntityAccessor<typeof networkLink>

  // Software
  readonly system: EntityAccessor<typeof system>
  readonly component: EntityAccessor<typeof component>
  readonly api: EntityAccessor<typeof softwareApi>
  readonly template: EntityAccessor<typeof template>
  readonly product: EntityAccessor<typeof product>
  readonly capability: EntityAccessor<typeof capability>

  // Org
  readonly team: EntityAccessor<typeof team>
  readonly principal: EntityAccessor<typeof principal>
  readonly agent: EntityAccessor<typeof agent>

  // Ops
  readonly site: EntityAccessor<typeof site>
  readonly systemDeployment: EntityAccessor<typeof systemDeployment>
  readonly workbench: EntityAccessor<typeof workbench>

  // Build
  readonly repo: EntityAccessor<typeof repo>
  readonly gitHostProvider: EntityAccessor<typeof gitHostProvider>

  // Dynamic — for runtime-determined kinds (inventory reconciler, CLI)
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
}

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class Ontology extends Context.Tag("Ontology")<
  Ontology,
  OntologyService
>() {}
