/**
 * Graph live layer — derives all accessors + parent traversal from the
 * graph IR (DxFactoryGraph) and table bindings (FACTORY_BINDINGS).
 */

import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import type { PgTable, PgColumn } from "drizzle-orm/pg-core"
import { EntityNotFoundError } from "@smp/factory-shared/effect/errors"

import { Db, query, type DatabaseError } from "./database"
import {
  Graph,
  makeEntityAccessor,
  type GraphService,
  type AncestorRef,
} from "../services/graph"
import type { Database } from "../../db/connection"
import { DxFactoryGraph } from "@smp/graph-dx-factory"
import { FACTORY_BINDINGS } from "../../db/bindings"
import type { TableBinding } from "@smp/graph/adapters/postgres/bindings"
import type { Adapter } from "@smp/graph/adapters/types"
import { makePostgresCodeAdapter } from "@smp/graph/adapters/postgres-code"
import { makePostgresDynamicAdapter } from "@smp/graph/adapters/postgres-dynamic"
import {
  makeGraphRegistry,
  makeCustomerLoader,
  type GraphRegistry,
} from "@smp/graph/runtime"
import type { EntityIR } from "@smp/graph"
import { graph as graphSchema } from "../../db/schema/index"

// ---------------------------------------------------------------------------
// Types for the kind index
// ---------------------------------------------------------------------------

interface KindEntry {
  readonly kind: string
  readonly binding: TableBinding
  readonly entity: EntityIR | undefined
}

// ---------------------------------------------------------------------------
// Parent traversal — walks the ancestry DAG breadth-first using IR links
// ---------------------------------------------------------------------------

/**
 * Collect the "parent" links for an entity: any manyToOne link whose target
 * has a binding and whose FK column exists in the binding's fks record.
 */
function getParentLinks(
  entityIR: EntityIR | undefined,
  binding: TableBinding,
  kindIndex: Map<string, KindEntry>
): Array<{ linkName: string; targetKind: string; fkColumn: PgColumn }> {
  if (!entityIR) return []

  const parents: Array<{
    linkName: string
    targetKind: string
    fkColumn: PgColumn
  }> = []

  for (const [linkName, linkDef] of Object.entries(entityIR.links)) {
    if (linkDef.cardinality !== "many-to-one") continue

    // The target kind in the IR — resolve it in the kind index
    const targetKind = linkDef.target
    if (!kindIndex.has(targetKind)) continue

    // Find the FK column from the binding's fks map
    const fkColumn = binding.fks?.[linkName]
    if (!fkColumn) continue

    parents.push({ linkName, targetKind, fkColumn })
  }

  return parents
}

function buildAncestors(db: Database, kindIndex: Map<string, KindEntry>) {
  return (
    kind: string,
    slugOrId: string
  ): Effect.Effect<AncestorRef[], DatabaseError | EntityNotFoundError> =>
    Effect.gen(function* () {
      const entry = kindIndex.get(kind)
      if (!entry) {
        return yield* new EntityNotFoundError({
          entity: kind,
          identifier: slugOrId,
        })
      }

      // Get the root entity first
      const accessor = makeEntityAccessor(
        db,
        entry.kind,
        entry.binding.table,
        entry.binding.slug,
        entry.binding.id
      )
      const rootEntity = yield* accessor.get(slugOrId)
      const root = rootEntity as Record<string, unknown>

      const ancestors: AncestorRef[] = []
      const visited = new Set<string>()

      // BFS queue: each item has the parent links to follow + the resolved entity
      const queue: Array<{
        parentLinks: Array<{
          linkName: string
          targetKind: string
          fkColumn: PgColumn
        }>
        entity: Record<string, unknown>
      }> = [
        {
          parentLinks: getParentLinks(entry.entity, entry.binding, kindIndex),
          entity: root,
        },
      ]

      while (queue.length > 0) {
        const { parentLinks, entity } = queue.shift()!

        for (const { targetKind, fkColumn } of parentLinks) {
          const parentEntry = kindIndex.get(targetKind)
          if (!parentEntry) continue

          // Get the FK value from the child entity
          const fkColumnName = fkColumn.name
          const parentId = entity[fkColumnName] as string | null | undefined
          if (!parentId) continue

          const visitKey = `${targetKind}:${parentId}`
          if (visited.has(visitKey)) continue
          visited.add(visitKey)

          // Fetch the parent entity
          const [parentRow] = yield* query(
            db
              .select()
              .from(parentEntry.binding.table as PgTable)
              .where(eq(parentEntry.binding.id, parentId))
              .limit(1) as unknown as Promise<Record<string, unknown>[]>
          )

          if (!parentRow) continue

          ancestors.push({
            kind: targetKind,
            id: parentId,
            slug: (parentRow as any).slug ?? parentId,
            entity: parentRow,
          })

          // Continue walking this parent's parents
          const nextParentLinks = getParentLinks(
            parentEntry.entity,
            parentEntry.binding,
            kindIndex
          )
          if (nextParentLinks.length > 0) {
            queue.push({ parentLinks: nextParentLinks, entity: parentRow })
          }
        }
      }

      return ancestors
    })
}

function buildSecretScopeChain(
  db: Database,
  kindIndex: Map<string, KindEntry>,
  ancestorsFn: ReturnType<typeof buildAncestors>
) {
  return (
    kind: string,
    slugOrId: string
  ): Effect.Effect<
    Array<{ scopeType: string; scopeId: string }>,
    DatabaseError | EntityNotFoundError
  > =>
    Effect.gen(function* () {
      const entry = kindIndex.get(kind)
      if (!entry) {
        return yield* new EntityNotFoundError({
          entity: kind,
          identifier: slugOrId,
        })
      }

      // Get the entity itself
      const accessor = makeEntityAccessor(
        db,
        entry.kind,
        entry.binding.table,
        entry.binding.slug,
        entry.binding.id
      )
      const entity = yield* accessor.get(slugOrId)
      const entityId = (entity as Record<string, unknown>).id as string

      // Start with the entity itself
      const chain: Array<{ scopeType: string; scopeId: string }> = [
        { scopeType: kind, scopeId: entityId },
      ]

      // Walk ancestors
      const ancestors = yield* ancestorsFn(kind, slugOrId)
      for (const ancestor of ancestors) {
        chain.push({ scopeType: ancestor.kind, scopeId: ancestor.id })
      }

      // Always end with org (global scope)
      chain.push({ scopeType: "org", scopeId: "" })

      return chain
    })
}

// ---------------------------------------------------------------------------
// Live layer
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Adapter + registry wiring (Task A12)
//
// Phase A: these are constructed so the wiring is in place and typechecks
// end-to-end (framework via postgres-code, customer via postgres-dynamic,
// IR composition via GraphRegistry). Existing service methods (get/find/
// list/ancestors) still resolve through the typed accessors below. Phase B
// will route them through adapterFor(kind).
// ---------------------------------------------------------------------------

function makeAdapters(db: Database): {
  code: Adapter
  dynamic: Adapter
  adapterFor: (kind: string) => Adapter
  registry: GraphRegistry
} {
  const code = makePostgresCodeAdapter({
    db,
    bindings: FACTORY_BINDINGS as unknown as Record<
      string,
      {
        table: any
        slug: any
        id: any
        fks: Record<string, any>
      }
    >,
  })
  const dynamic = makePostgresDynamicAdapter({
    db,
    tables: { instance: graphSchema.instance, link: graphSchema.link },
  })
  const adapterFor = (kind: string): Adapter =>
    kind in FACTORY_BINDINGS ? code : dynamic

  const registry = makeGraphRegistry({
    base: DxFactoryGraph,
    loadCustomer: makeCustomerLoader({
      db,
      tables: { objectType: graphSchema.objectType },
    }),
  })

  return { code, dynamic, adapterFor, registry }
}

export const GraphLive = Layer.effect(
  Graph,
  Effect.gen(function* () {
    const db = yield* Db

    // Adapter + registry wiring — not yet consumed by service methods (Phase B).
    const _wiring = makeAdapters(db)
    void _wiring

    // Build kind index from IR entities + bindings
    const kindIndex = new Map<string, KindEntry>()

    for (const [bindingKey, binding] of Object.entries(FACTORY_BINDINGS)) {
      // The binding key IS the kind string (e.g., "estate", "system-deployment")
      const kind = bindingKey
      const entityIR = DxFactoryGraph.entities[kind]

      kindIndex.set(kind, { kind, binding, entity: entityIR })
    }

    // Build all typed accessors from bindings
    const accessors = {} as Record<string, unknown>
    for (const [key, binding] of Object.entries(FACTORY_BINDINGS)) {
      accessors[key] = makeEntityAccessor(
        db,
        key,
        binding.table,
        binding.slug,
        binding.id
      )
    }

    // Dynamic access
    const dynamicGet = (kind: string, slugOrId: string) => {
      const entry = kindIndex.get(kind)
      if (!entry) {
        return Effect.fail(
          new EntityNotFoundError({ entity: kind, identifier: slugOrId })
        )
      }
      return makeEntityAccessor(
        db,
        entry.kind,
        entry.binding.table,
        entry.binding.slug,
        entry.binding.id
      ).get(slugOrId) as Effect.Effect<
        Record<string, unknown>,
        DatabaseError | EntityNotFoundError
      >
    }

    const dynamicFind = (kind: string, slugOrId: string) => {
      const entry = kindIndex.get(kind)
      if (!entry) return Effect.succeed(null)
      return makeEntityAccessor(
        db,
        entry.kind,
        entry.binding.table,
        entry.binding.slug,
        entry.binding.id
      ).find(slugOrId) as Effect.Effect<
        Record<string, unknown> | null,
        DatabaseError
      >
    }

    // Parent traversal
    const ancestorsFn = buildAncestors(db, kindIndex)
    const secretScopeChainFn = buildSecretScopeChain(db, kindIndex, ancestorsFn)

    return {
      ...accessors,
      get: dynamicGet,
      find: dynamicFind,
      ancestors: ancestorsFn,
      secretScopeChain: secretScopeChainFn,
    } as GraphService
  })
)
