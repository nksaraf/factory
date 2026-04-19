/**
 * Ontology service — strongly typed entity access derived from a single
 * entity map. Adding a new entity = add one line to ENTITY_MAP.
 *
 *   const est = yield* ontology.estate.get("my-estate")
 *   const teams = yield* ontology.team.list()
 *
 * Types, accessors, and layer all derive from ENTITY_MAP.
 */

import { Context, Effect } from "effect"
import { type InferSelectModel, type SQL, eq, or } from "drizzle-orm"
import type { PgColumn, PgTable } from "drizzle-orm/pg-core"
import { EntityNotFoundError } from "@smp/factory-shared/effect/errors"

import { query, type DatabaseError } from "../layers/database"
import { isPrefixedId } from "../../lib/resolvers"
import type { Database } from "../../db/connection"

// ---------------------------------------------------------------------------
// Entity accessor — what each ontology.X returns
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
// ENTITY_MAP — THE SINGLE SOURCE OF TRUTH
//
// Add one line here to register a new entity. Types, accessors, and
// the layer all derive from this map automatically.
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

function e<T extends PgTable>(
  kind: string,
  table: T,
  slug: PgColumn,
  id: PgColumn
) {
  return { kind, table, slug, id } as const
}

export const ENTITY_MAP = {
  // Infra
  estate: e("estate", estate, estate.slug, estate.id),
  host: e("host", host, host.slug, host.id),
  realm: e("realm", realm, realm.slug, realm.id),
  service: e("service", service, service.slug, service.id),
  route: e("route", route, route.slug, route.id),
  dnsDomain: e("dns-domain", dnsDomain, dnsDomain.slug, dnsDomain.id),
  networkLink: e("network-link", networkLink, networkLink.slug, networkLink.id),

  // Software
  system: e("system", system, system.slug, system.id),
  component: e("component", component, component.slug, component.id),
  api: e("api", softwareApi, softwareApi.slug, softwareApi.id),
  template: e("template", template, template.slug, template.id),
  product: e("product", product, product.slug, product.id),
  capability: e("capability", capability, capability.slug, capability.id),

  // Org
  team: e("team", team, team.slug, team.id),
  principal: e("principal", principal, principal.slug, principal.id),
  agent: e("agent", agent, agent.slug, agent.id),

  // Ops
  site: e("site", site, site.slug, site.id),
  systemDeployment: e(
    "system-deployment",
    systemDeployment,
    systemDeployment.slug,
    systemDeployment.id
  ),
  workbench: e("workbench", workbench, workbench.slug, workbench.id),

  // Build
  repo: e("repository", repo, repo.slug, repo.id),
  gitHostProvider: e(
    "git-host-provider",
    gitHostProvider,
    gitHostProvider.slug,
    gitHostProvider.id
  ),
} as const

// ---------------------------------------------------------------------------
// Derived types — no manual interface declaration needed
// ---------------------------------------------------------------------------

type EntityMap = typeof ENTITY_MAP

/** The full typed ontology service — derived from ENTITY_MAP. */
export type OntologyService = {
  readonly [K in keyof EntityMap]: EntityAccessor<EntityMap[K]["table"]>
} & {
  /** Dynamic access by kind string (for runtime-determined entity types). */
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
