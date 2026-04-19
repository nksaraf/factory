/**
 * Ontology live layer — derives all accessors from ENTITY_MAP.
 * No manual per-entity wiring. Adding an entity to ENTITY_MAP is enough.
 */

import { Effect, Layer } from "effect"
import { EntityNotFoundError } from "@smp/factory-shared/effect/errors"

import { Db, type DatabaseError } from "./database"
import {
  Ontology,
  ENTITY_MAP,
  makeEntityAccessor,
  type OntologyService,
} from "../services/ontology"

export const OntologyLive = Layer.effect(
  Ontology,
  Effect.gen(function* () {
    const db = yield* Db

    // Build all typed accessors from the entity map — one loop, no manual entries
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

    // Dynamic access by kind string (for inventory reconciler, CLI, etc.)
    // Looks up the entity map at runtime by kind
    const kindIndex = new Map(
      Object.values(ENTITY_MAP).map((def) => [def.kind, def])
    )

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

    return {
      ...accessors,
      get: dynamicGet,
      find: dynamicFind,
    } as OntologyService
  })
)
