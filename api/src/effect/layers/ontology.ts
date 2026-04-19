/**
 * Ontology live layer — derives all accessors + parent traversal from ENTITY_MAP.
 */

import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"
import { EntityNotFoundError } from "@smp/factory-shared/effect/errors"

import { Db, query, type DatabaseError } from "./database"
import {
  Ontology,
  ENTITY_MAP,
  makeEntityAccessor,
  type OntologyService,
  type AncestorRef,
  type ParentRef,
} from "../services/ontology"
import type { Database } from "../../db/connection"

// ---------------------------------------------------------------------------
// Parent traversal — walks the ancestry DAG breadth-first
// ---------------------------------------------------------------------------

function buildAncestors(
  db: Database,
  kindIndex: Map<string, (typeof ENTITY_MAP)[keyof typeof ENTITY_MAP]>
) {
  return (
    kind: string,
    slugOrId: string
  ): Effect.Effect<AncestorRef[], DatabaseError | EntityNotFoundError> =>
    Effect.gen(function* () {
      const def = kindIndex.get(kind)
      if (!def) {
        return yield* new EntityNotFoundError({
          entity: kind,
          identifier: slugOrId,
        })
      }

      // Get the root entity first
      const accessor = makeEntityAccessor(
        db,
        def.kind,
        def.table,
        def.slug,
        def.id
      )
      const rootEntity = yield* accessor.get(slugOrId)
      const root = rootEntity as Record<string, unknown>

      const ancestors: AncestorRef[] = []
      const visited = new Set<string>() // "kind:id" to prevent cycles

      // BFS queue: each item is a parent ref to follow from a resolved entity
      const queue: Array<{
        parentRefs: readonly ParentRef[]
        entity: Record<string, unknown>
      }> = [{ parentRefs: def.parents, entity: root }]

      while (queue.length > 0) {
        const { parentRefs, entity } = queue.shift()!

        for (const parentRef of parentRefs) {
          const parentDef = kindIndex.get(parentRef.kind)
          if (!parentDef) continue

          // Get the FK value from the child entity
          const fkColumnName = parentRef.fk.name
          const parentId = entity[fkColumnName] as string | null | undefined
          if (!parentId) continue

          const visitKey = `${parentRef.kind}:${parentId}`
          if (visited.has(visitKey)) continue
          visited.add(visitKey)

          // Fetch the parent entity
          const [parentRow] = yield* query(
            db
              .select()
              .from(parentDef.table as PgTable)
              .where(eq(parentDef.id, parentId))
              .limit(1) as unknown as Promise<Record<string, unknown>[]>
          )

          if (!parentRow) continue

          ancestors.push({
            kind: parentRef.kind,
            id: parentId,
            slug: (parentRow as any).slug ?? parentId,
            entity: parentRow,
          })

          // Continue walking this parent's parents
          if (parentDef.parents.length > 0) {
            queue.push({ parentRefs: parentDef.parents, entity: parentRow })
          }
        }
      }

      return ancestors
    })
}

function buildSecretScopeChain(
  db: Database,
  kindIndex: Map<string, (typeof ENTITY_MAP)[keyof typeof ENTITY_MAP]>,
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
      const def = kindIndex.get(kind)
      if (!def) {
        return yield* new EntityNotFoundError({
          entity: kind,
          identifier: slugOrId,
        })
      }

      // Get the entity itself
      const accessor = makeEntityAccessor(
        db,
        def.kind,
        def.table,
        def.slug,
        def.id
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

export const OntologyLive = Layer.effect(
  Ontology,
  Effect.gen(function* () {
    const db = yield* Db

    // Build all typed accessors from the entity map
    const accessors = {} as Record<string, unknown>
    for (const [key, def] of Object.entries(ENTITY_MAP)) {
      accessors[key] = makeEntityAccessor(
        db,
        def.kind,
        def.table,
        def.slug,
        def.id
      )
    }

    // Kind index for dynamic + ancestor lookups
    const kindIndex = new Map(
      Object.values(ENTITY_MAP).map((def) => [def.kind, def])
    )

    // Dynamic access
    const dynamicGet = (kind: string, slugOrId: string) => {
      const def = kindIndex.get(kind)
      if (!def) {
        return Effect.fail(
          new EntityNotFoundError({ entity: kind, identifier: slugOrId })
        )
      }
      return makeEntityAccessor(db, def.kind, def.table, def.slug, def.id).get(
        slugOrId
      ) as Effect.Effect<
        Record<string, unknown>,
        DatabaseError | EntityNotFoundError
      >
    }

    const dynamicFind = (kind: string, slugOrId: string) => {
      const def = kindIndex.get(kind)
      if (!def) return Effect.succeed(null)
      return makeEntityAccessor(db, def.kind, def.table, def.slug, def.id).find(
        slugOrId
      ) as Effect.Effect<Record<string, unknown> | null, DatabaseError>
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
    } as OntologyService
  })
)
