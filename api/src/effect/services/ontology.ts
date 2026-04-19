/**
 * Ontology service — strongly typed entity access + parent hierarchy.
 *
 * ENTITY_MAP is the single source of truth. Adding a new entity = add one
 * line. Types, accessors, parent chains, and the layer all derive from it.
 *
 *   const ontology = yield* Ontology
 *   const est = yield* ontology.estate.get("my-estate")
 *   const chain = yield* ontology.ancestors("component-deployment", "api-prod")
 *   //=> [componentDeployment, systemDeployment, site, component, system, org]
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
// Parent relationship definition
// ---------------------------------------------------------------------------

export interface ParentRef {
  /** The kind of the parent entity (must be a key in ENTITY_MAP) */
  readonly kind: string
  /** The FK column on THIS entity that points to the parent's ID */
  readonly fk: PgColumn
}

// ---------------------------------------------------------------------------
// Entity definition helper
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
  id: PgColumn,
  parents?: ParentRef[]
) {
  return { kind, table, slug, id, parents: parents ?? [] } as const
}

// ---------------------------------------------------------------------------
// ENTITY_MAP — THE SINGLE SOURCE OF TRUTH
//
// Add one line here to register a new entity. Types, accessors, parent
// chains, and the layer all derive from this map automatically.
//
// Parent relationships define the secret inheritance hierarchy:
//   component-deployment → system-deployment → site (infra lineage)
//   component-deployment → component → system (software lineage)
//   host → estate → estate (recursive) → org
// ---------------------------------------------------------------------------

export const ENTITY_MAP = {
  // ── Infra ─────────────────────────────────────────────────
  estate: e("estate", estate, estate.slug, estate.id, [
    { kind: "estate", fk: estate.parentEstateId }, // recursive
  ]),
  host: e("host", host, host.slug, host.id, [
    { kind: "estate", fk: host.estateId },
  ]),
  realm: e("realm", realm, realm.slug, realm.id, [
    { kind: "estate", fk: realm.estateId },
  ]),
  service: e("service", service, service.slug, service.id, [
    { kind: "estate", fk: service.estateId },
  ]),
  route: e("route", route, route.slug, route.id),
  dnsDomain: e("dns-domain", dnsDomain, dnsDomain.slug, dnsDomain.id),
  networkLink: e("network-link", networkLink, networkLink.slug, networkLink.id),

  // ── Software ──────────────────────────────────────────────
  system: e("system", system, system.slug, system.id), // root of software hierarchy
  component: e("component", component, component.slug, component.id, [
    { kind: "system", fk: component.systemId },
  ]),
  api: e("api", softwareApi, softwareApi.slug, softwareApi.id, [
    { kind: "system", fk: softwareApi.systemId },
  ]),
  template: e("template", template, template.slug, template.id),
  product: e("product", product, product.slug, product.id),
  capability: e("capability", capability, capability.slug, capability.id),

  // ── Org ───────────────────────────────────────────────────
  team: e("team", team, team.slug, team.id, [
    { kind: "team", fk: team.parentTeamId }, // recursive
  ]),
  principal: e("principal", principal, principal.slug, principal.id),
  agent: e("agent", agent, agent.slug, agent.id),

  // ── Ops (dual lineage: infra + software) ──────────────────
  site: e("site", site, site.slug, site.id), // root of ops hierarchy
  systemDeployment: e(
    "system-deployment",
    systemDeployment,
    systemDeployment.slug,
    systemDeployment.id,
    [
      { kind: "site", fk: systemDeployment.siteId }, // infra lineage
      { kind: "system", fk: systemDeployment.systemId }, // software lineage
    ]
  ),
  workbench: e("workbench", workbench, workbench.slug, workbench.id, [
    { kind: "site", fk: workbench.siteId },
  ]),

  // ── Build ─────────────────────────────────────────────────
  repo: e("repository", repo, repo.slug, repo.id),
  gitHostProvider: e(
    "git-host-provider",
    gitHostProvider,
    gitHostProvider.slug,
    gitHostProvider.id
  ),
} as const

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
// Derived types
// ---------------------------------------------------------------------------

type EntityMap = typeof ENTITY_MAP

export type OntologyService = {
  readonly [K in keyof EntityMap]: EntityAccessor<EntityMap[K]["table"]>
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
   * @example
   * ```ts
   * const chain = yield* ontology.ancestors("system-deployment", "api-prod")
   * // [{ kind: "site", ... }, { kind: "system", ... }, ...]
   * ```
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

export class Ontology extends Context.Tag("Ontology")<
  Ontology,
  OntologyService
>() {}
