/**
 * Tests for the Effect DB layer.
 *
 * API matches drizzle-orm/effect-postgres pattern:
 *   const db = yield* Db
 *   const users = yield* query(db.select().from(usersTable))
 *
 * When migrating to Drizzle 1.0, remove `query()` wrappers:
 *   const users = yield* db.select().from(usersTable)
 */

import { describe, it, expect, beforeAll } from "bun:test"
import { Effect, Exit, Cause, Option, Layer } from "effect"
import type { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"

import type { Database } from "../db/connection"
import { team } from "../db/schema/org"
import { createMigratedTestPglite } from "../test-helpers"
import { newId } from "../lib/id"
import {
  Db,
  makeDbLayer,
  query,
  queryOrNotFound,
  withTransaction,
  DatabaseError,
  runEffect,
} from "../effect"

let client: PGlite
let db: Database
let dbLayer: Layer.Layer<Db>

beforeAll(async () => {
  const ctx = await createMigratedTestPglite()
  client = ctx.client
  db = ctx.db as unknown as Database
  dbLayer = makeDbLayer(db)
})

function run<A, E>(effect: Effect.Effect<A, E, Db>) {
  return Effect.runPromise(Effect.provide(effect, dbLayer))
}

function runExit<A, E>(effect: Effect.Effect<A, E, Db>) {
  return Effect.runPromiseExit(Effect.provide(effect, dbLayer))
}

describe("query()", () => {
  it("wraps a Drizzle query builder in an Effect", async () => {
    const result = await run(
      Effect.gen(function* () {
        const db = yield* Db
        return yield* query(db.select().from(team).limit(0))
      })
    )
    expect(result).toEqual([])
  })

  it("classifies unique_violation as DatabaseError", async () => {
    const id = newId("team")

    await run(
      Effect.gen(function* () {
        const db = yield* Db
        yield* query(
          db.insert(team).values({
            id,
            slug: `uv-test-${Date.now()}`,
            name: "Test Team",
            type: "team",
          })
        )
      })
    )

    const exit = await runExit(
      Effect.gen(function* () {
        const db = yield* Db
        yield* query(
          db.insert(team).values({
            id, // same PK
            slug: `uv-different-${Date.now()}`,
            name: "Dupe",
            type: "team",
          })
        )
      })
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause)
      expect(Option.isSome(failure)).toBe(true)
      if (Option.isSome(failure)) {
        const err = failure.value
        expect(err).toBeInstanceOf(DatabaseError)
        expect((err as DatabaseError).variant).toBe("unique_violation")
        expect((err as DatabaseError).pgCode).toBe("23505")
        expect((err as DatabaseError).httpStatus).toBe(409)
      }
    }
  })
})

describe("queryOrNotFound()", () => {
  it("returns the row when found", async () => {
    const slug = `found-test-${Date.now()}`

    const result = await run(
      Effect.gen(function* () {
        const db = yield* Db
        yield* query(
          db.insert(team).values({
            id: newId("team"),
            slug,
            name: "Found",
            type: "team",
          })
        )
        return yield* queryOrNotFound(
          db.select().from(team).where(eq(team.slug, slug)).limit(1),
          "team",
          slug
        )
      })
    )

    expect(result.slug).toBe(slug)
  })

  it("fails with EntityNotFoundError when not found", async () => {
    const exit = await runExit(
      Effect.gen(function* () {
        const db = yield* Db
        return yield* queryOrNotFound(
          db
            .select()
            .from(team)
            .where(eq(team.slug, "nonexistent-xyz"))
            .limit(1),
          "team",
          "nonexistent-xyz"
        )
      })
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause)
      expect(Option.isSome(failure)).toBe(true)
      if (Option.isSome(failure)) {
        expect(failure.value._tag).toBe("EntityNotFoundError")
      }
    }
  })
})

describe("withTransaction()", () => {
  it("commits on success", async () => {
    const slug = `tx-commit-${Date.now()}`

    await run(
      withTransaction(
        Effect.gen(function* () {
          const db = yield* Db // this is the tx connection
          yield* query(
            db.insert(team).values({
              id: newId("team"),
              slug,
              name: "TX Team",
              type: "team",
            })
          )
        })
      )
    )

    const rows = await run(
      Effect.gen(function* () {
        const db = yield* Db
        return yield* query(
          db.select().from(team).where(eq(team.slug, slug)).limit(1)
        )
      })
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe("TX Team")
  })

  it("rolls back on failure", async () => {
    const slug = `tx-rollback-${Date.now()}`

    const exit = await runExit(
      withTransaction(
        Effect.gen(function* () {
          const db = yield* Db
          yield* query(
            db.insert(team).values({
              id: newId("team"),
              slug,
              name: "Should Rollback",
              type: "team",
            })
          )
          return yield* Effect.fail(
            new DatabaseError({
              variant: "query_failed",
              message: "intentional failure",
            })
          )
        })
      )
    )

    expect(Exit.isFailure(exit)).toBe(true)

    const rows = await run(
      Effect.gen(function* () {
        const db = yield* Db
        return yield* query(
          db.select().from(team).where(eq(team.slug, slug)).limit(1)
        )
      })
    )
    expect(rows).toHaveLength(0)
  })

  it("inner queries use the transaction connection automatically", async () => {
    const slug1 = `tx-nested-1-${Date.now()}`
    const slug2 = `tx-nested-2-${Date.now()}`

    await run(
      withTransaction(
        Effect.gen(function* () {
          const db = yield* Db // tx connection provided by withTransaction
          yield* query(
            db
              .insert(team)
              .values({
                id: newId("team"),
                slug: slug1,
                name: "N1",
                type: "team",
              })
          )
          yield* query(
            db
              .insert(team)
              .values({
                id: newId("team"),
                slug: slug2,
                name: "N2",
                type: "team",
              })
          )
        })
      )
    )

    const [r1, r2] = await Promise.all([
      run(
        Effect.gen(function* () {
          const db = yield* Db
          return yield* query(
            db.select().from(team).where(eq(team.slug, slug1))
          )
        })
      ),
      run(
        Effect.gen(function* () {
          const db = yield* Db
          return yield* query(
            db.select().from(team).where(eq(team.slug, slug2))
          )
        })
      ),
    ])
    expect(r1).toHaveLength(1)
    expect(r2).toHaveLength(1)
  })
})

describe("runEffect() bridge", () => {
  it("translates DatabaseError unique_violation to ConflictError", async () => {
    const id = newId("team")

    await run(
      Effect.gen(function* () {
        const db = yield* Db
        yield* query(
          db
            .insert(team)
            .values({ id, slug: `br-${Date.now()}`, name: "B", type: "team" })
        )
      })
    )

    try {
      await runEffect(
        Effect.provide(
          Effect.gen(function* () {
            const db = yield* Db
            yield* query(
              db
                .insert(team)
                .values({
                  id,
                  slug: `br2-${Date.now()}`,
                  name: "D",
                  type: "team",
                })
            )
          }),
          dbLayer
        )
      )
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.constructor.name).toBe("ConflictError")
      expect(err.status).toBe(409)
    }
  })

  it("translates EntityNotFoundError to NotFoundError", async () => {
    try {
      await runEffect(
        Effect.provide(
          Effect.gen(function* () {
            const db = yield* Db
            return yield* queryOrNotFound(
              db.select().from(team).where(eq(team.slug, "nope")).limit(1),
              "team",
              "nope"
            )
          }),
          dbLayer
        )
      )
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.constructor.name).toBe("NotFoundError")
      expect(err.status).toBe(404)
    }
  })
})
