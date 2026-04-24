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
import type { EntityIR, JsonSchema } from "../schema/ir"
import type { CustomerLoader, CustomerLoadResult } from "./registry"

interface Deps {
  readonly db: { select: (..._a: unknown[]) => any }
  readonly tables: { readonly objectType: any }
}

function rowToEntity(row: Record<string, unknown>): EntityIR {
  return {
    kind: String(row.kind),
    namespace: (row.namespace as string) ?? "customer",
    prefix: (row.prefix as string) ?? String(row.kind).slice(0, 4),
    plural: (row.plural as string) ?? `${row.kind}s`,
    description: (row.description as string) ?? undefined,
    traits: (row.traits as string[] | null) ?? [],
    implements: (row.implements as string[] | null) ?? undefined,
    schemas: {
      spec: (row.specSchema as JsonSchema) ?? {},
      status: (row.statusSchema as JsonSchema) ?? {},
      metadata: {},
    },
    annotations: (row.annotations as Record<string, unknown>) ?? {},
    identity: { slugScope: "global" },
    reconciliation: false,
    bitemporal: false,
    softDelete: false,
    links: (row.links as Record<string, any>) ?? {},
    derived: {},
    actions: {},
    access: (row.access as any) ?? undefined,
    visibility: "normal",
    lifecycle: "production",
  }
}

export function makeCustomerLoader(deps: Deps): CustomerLoader {
  return (graphId) =>
    Effect.tryPromise(async (): Promise<CustomerLoadResult> => {
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
    }).pipe(Effect.orDie)
}
