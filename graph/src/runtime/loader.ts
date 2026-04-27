/**
 * Customer loader — reads customer-layer definitions from the Postgres
 * `graph` schema and returns them as IR nodes for the GraphRegistry to
 * merge into the compiled base IR.
 *
 * Phase A: loads object_type rows into EntityIR. link_type / interface /
 * shared_property / value_type / struct / action / function / extension
 * loading lands in later phases.
 */

import { Effect } from "effect"
import { eq } from "drizzle-orm"
import type { EntityIR } from "../schema/ir"
import type { JsonSchema, PropertyAnnotations } from "../schema/types"
import type { CustomerLoader, CustomerLoadResult } from "./registry"

interface Deps {
  readonly db: { select: (..._a: unknown[]) => any }
  readonly tables: { readonly objectType: any }
}

/**
 * Map a graph.object_type row to an EntityIR.
 *
 * The schema columns we read from are: kind, extendsKind, specSchema,
 * statusSchema, annotations, implements, traits, access, plus the JSONB
 * `metadata` column which we use for fields that don't have dedicated
 * columns (namespace, prefix, plural, description, links, identity,
 * bitemporal, reconciliation, softDelete, visibility, lifecycle).
 *
 * The metadata fallback keeps the table narrow now and lets us promote
 * specific fields to columns later (with a migration) without changing
 * the IR shape.
 */
function rowToEntity(row: Record<string, unknown>): EntityIR {
  const meta = (row.metadata as Record<string, unknown> | null) ?? {}
  const kind = String(row.kind)
  return {
    kind,
    namespace: (meta.namespace as string) ?? "customer",
    prefix: (meta.prefix as string) ?? kind.slice(0, 4),
    plural: (meta.plural as string) ?? `${kind}s`,
    description: (meta.description as string) ?? undefined,
    traits: (row.traits as string[] | null) ?? [],
    implements: (row.implements as string[] | null) ?? undefined,
    schemas: {
      spec: (row.specSchema as JsonSchema) ?? {},
      status: (row.statusSchema as JsonSchema) ?? {},
      metadata: (meta.schema as JsonSchema) ?? {},
    },
    annotations: (row.annotations as PropertyAnnotations) ?? {},
    identity: (meta.identity as EntityIR["identity"]) ?? {
      slugScope: "global",
    },
    reconciliation: Boolean(meta.reconciliation),
    bitemporal: Boolean(meta.bitemporal),
    softDelete: (meta.softDelete as EntityIR["softDelete"]) ?? false,
    links: (meta.links as Record<string, any>) ?? {},
    derived: {},
    actions: {},
    access: (row.access as EntityIR["access"]) ?? undefined,
    visibility: (meta.visibility as EntityIR["visibility"]) ?? "normal",
    lifecycle: (meta.lifecycle as EntityIR["lifecycle"]) ?? "production",
  }
}

export function makeCustomerLoader(deps: Deps): CustomerLoader {
  return (graphId) =>
    Effect.tryPromise({
      try: async (): Promise<CustomerLoadResult> => {
        const t = deps.tables.objectType
        const rows: Record<string, unknown>[] = await deps.db
          .select()
          .from(t)
          .where(eq(t.graphId, graphId))
        const objectTypes: Record<string, EntityIR> = {}
        for (const row of rows) {
          const entity = rowToEntity(row)
          objectTypes[entity.kind] = entity
        }
        return { objectTypes }
      },
      catch: (err) => (err instanceof Error ? err : new Error(String(err))),
    })
}
