/**
 * Database service layer for Effect programs.
 *
 * API designed to match drizzle-orm/effect-postgres so migration is a
 * find-and-replace (remove `query()` wrappers).
 *
 * Today (Drizzle 0.45):
 *   const db = yield* Db
 *   const users = yield* query(db.select().from(usersTable))
 *
 * After Drizzle 1.0 (effect-postgres):
 *   const db = yield* Db
 *   const users = yield* db.select().from(usersTable)
 *
 * Migration: remove all `query()` wrappers. Everything else stays.
 *
 * Provides:
 *   - `Db`              — Drizzle database instance from context
 *   - `query`           — wrap a Drizzle query builder in Effect (migration shim)
 *   - `queryOrNotFound` — query + fail if empty (permanent — Drizzle doesn't have this)
 *   - `withTransaction` — run Effect in a DB transaction; swaps Db context to tx
 *   - `DatabaseError`   — typed error classifying Postgres error codes
 */

import { Context, Data, Effect, Layer, Cause, Option } from "effect"
import type { Database } from "../../db/connection"
import { EntityNotFoundError } from "@smp/factory-shared/effect/errors"

// ---------------------------------------------------------------------------
// Typed database errors
// ---------------------------------------------------------------------------

interface PgError {
  code?: string
  constraint?: string
  detail?: string
  table?: string
  column?: string
}

function hasPgCode(
  err: unknown
): err is { code: string; message: string } & PgError {
  if (err == null || typeof err !== "object") return false
  const e = err as any
  return typeof e.code === "string" && /^\d{5}$/.test(e.code)
}

function findPgError(
  err: unknown
): ({ code: string; message: string } & PgError) | null {
  let current: unknown = err
  for (let depth = 0; depth < 5 && current != null; depth++) {
    if (hasPgCode(current)) return current
    current = (current as any)?.cause
  }
  return null
}

export type DatabaseErrorVariant =
  | "connection_failed"
  | "query_failed"
  | "unique_violation"
  | "foreign_key_violation"
  | "check_violation"
  | "not_null_violation"
  | "serialization_failure"
  | "deadlock"
  | "timeout"
  | "unknown"

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly variant: DatabaseErrorVariant
  readonly message: string
  readonly pgCode?: string
  readonly constraint?: string
  readonly table?: string
  readonly detail?: string
}> {
  get httpStatus(): number {
    switch (this.variant) {
      case "unique_violation":
        return 409
      case "foreign_key_violation":
      case "check_violation":
      case "not_null_violation":
        return 422
      case "serialization_failure":
      case "deadlock":
      case "connection_failed":
        return 503
      case "timeout":
        return 504
      default:
        return 500
    }
  }
}

export function classifyDatabaseError(error: unknown): DatabaseError {
  const pgErr = findPgError(error)
  if (pgErr) {
    const base = {
      message: pgErr.message,
      pgCode: pgErr.code,
      constraint: pgErr.constraint,
      table: pgErr.table,
      detail: pgErr.detail,
    }
    switch (pgErr.code) {
      case "23505":
        return new DatabaseError({ ...base, variant: "unique_violation" })
      case "23503":
        return new DatabaseError({ ...base, variant: "foreign_key_violation" })
      case "23514":
        return new DatabaseError({ ...base, variant: "check_violation" })
      case "23502":
        return new DatabaseError({ ...base, variant: "not_null_violation" })
      case "40001":
        return new DatabaseError({ ...base, variant: "serialization_failure" })
      case "40P01":
        return new DatabaseError({ ...base, variant: "deadlock" })
      case "57014":
        return new DatabaseError({ ...base, variant: "timeout" })
      case "08000":
      case "08001":
      case "08003":
      case "08006":
        return new DatabaseError({ ...base, variant: "connection_failed" })
      default:
        return new DatabaseError({ ...base, variant: "query_failed" })
    }
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (msg.includes("econnrefused") || msg.includes("connection")) {
      return new DatabaseError({
        variant: "connection_failed",
        message: error.message,
      })
    }
    return new DatabaseError({
      variant: "query_failed",
      message: error.message,
    })
  }

  return new DatabaseError({ variant: "unknown", message: String(error) })
}

// ---------------------------------------------------------------------------
// Service tag — matches drizzle-orm/effect-postgres pattern
// ---------------------------------------------------------------------------

/**
 * The Drizzle database instance, provided via context.
 *
 * Usage matches drizzle-orm/effect-postgres:
 *   const db = yield* Db
 *
 * Today you wrap queries with `query()`:
 *   const users = yield* query(db.select().from(usersTable))
 *
 * After migration to drizzle-orm/effect-postgres, remove the wrapper:
 *   const users = yield* db.select().from(usersTable)
 */
export class Db extends Context.Tag("Db")<Db, Database>() {}

/** Build a Db layer from an existing Database instance. */
export const makeDbLayer = (db: Database): Layer.Layer<Db> =>
  Layer.succeed(Db, db)

// ---------------------------------------------------------------------------
// Query — migration shim
// ---------------------------------------------------------------------------

/**
 * Wrap a Drizzle query builder (which returns a PromiseLike) in an Effect.
 *
 * This is a **migration shim**. When upgrading to drizzle-orm/effect-postgres,
 * Drizzle query builders will return Effects directly. At that point, remove
 * all `query()` wrappers — the rest of your code stays identical.
 *
 * @example
 * ```ts
 * // Today (Drizzle 0.45):
 * const db = yield* Db
 * const users = yield* query(db.select().from(usersTable))
 *
 * // After Drizzle 1.0 migration — just remove query():
 * const db = yield* Db
 * const users = yield* db.select().from(usersTable)
 * ```
 */
export function query<A>(
  queryBuilder: PromiseLike<A>
): Effect.Effect<A, DatabaseError> {
  return Effect.tryPromise({
    try: () => Promise.resolve(queryBuilder),
    catch: classifyDatabaseError,
  })
}

// ---------------------------------------------------------------------------
// queryOrNotFound — permanent helper (Drizzle doesn't have this)
// ---------------------------------------------------------------------------

/**
 * Run a query that should return at least one row.
 * Returns the first row, or fails with `EntityNotFoundError` if empty.
 *
 * This helper is permanent — it adds application-level semantics that
 * Drizzle's Effect integration doesn't provide.
 *
 * @example
 * ```ts
 * const db = yield* Db
 * const sys = yield* queryOrNotFound(
 *   db.select().from(system).where(eq(system.slug, slug)).limit(1),
 *   "system", slug,
 * )
 * ```
 */
export function queryOrNotFound<A>(
  queryBuilder: PromiseLike<A[]>,
  entity: string,
  identifier: string
): Effect.Effect<A, DatabaseError | EntityNotFoundError> {
  return Effect.flatMap(query(queryBuilder), (rows) =>
    rows.length === 0
      ? Effect.fail(new EntityNotFoundError({ entity, identifier }))
      : Effect.succeed(rows[0])
  )
}

// ---------------------------------------------------------------------------
// Transactions — matches drizzle-orm/effect-postgres pattern
//
// KNOWN LIMITATION: Uses Effect.runPromiseExit inside Effect.async because
// Drizzle 0.45's db.transaction() requires a Promise callback. This creates
// a nested runtime fiber that cannot be interrupted from the outside.
// When Drizzle 1.0 ships with effect-postgres, replace this entire function
// with their native transaction Effect. The sentinel envelope approach below
// is a deliberate workaround to propagate typed failures and defects across
// the Promise boundary.
// ---------------------------------------------------------------------------

/** Sentinel wrapper for typed failures thrown across the transaction boundary. */
interface EffectFailureEnvelope {
  readonly __effectFailure: true
  readonly error: unknown
}

/** Sentinel wrapper for defects thrown across the transaction boundary. */
interface EffectDefectEnvelope {
  readonly __effectDefect: true
  readonly cause: Cause.Cause<never>
}

/**
 * Run an Effect program inside a database transaction.
 *
 * Commits on success, rolls back on failure or interruption. Inside the
 * transaction, a new `Db` layer is provided with the transactional connection
 * — so all `query()` calls (and future direct Drizzle queries) automatically
 * use the transaction. No manual `tx` passing.
 *
 * **Limitation:** The inner effect must only depend on `Db` — any other
 * context requirements must be provided before calling `withTransaction`.
 * This is because the transaction boundary calls `Effect.runPromiseExit`
 * which requires all non-Db requirements to be satisfied.
 *
 * @example
 * ```ts
 * yield* withTransaction(
 *   Effect.gen(function* () {
 *     const db = yield* Db  // this is the tx connection
 *     yield* query(db.insert(team).values({...}))
 *     yield* query(db.insert(membership).values({...}))
 *   })
 * )
 * ```
 */
export function withTransaction<A, E>(
  effect: Effect.Effect<A, E, Db>
): Effect.Effect<A, E | DatabaseError, Db> {
  return Effect.flatMap(Db, (outerDb) =>
    Effect.async<A, E | DatabaseError>((resume) => {
      outerDb
        .transaction(async (tx) => {
          const txLayer = makeDbLayer(tx as unknown as Database)
          const exit = await Effect.runPromiseExit(
            Effect.provide(effect, txLayer)
          )
          if (exit._tag === "Success") return exit.value

          // Use Cause.failureOption to properly extract typed failures
          const failOpt = Cause.failureOption(exit.cause)
          if (Option.isSome(failOpt)) {
            throw {
              __effectFailure: true,
              error: failOpt.value,
            } satisfies EffectFailureEnvelope
          }

          // Defect or interrupt — wrap for proper handling
          throw {
            __effectDefect: true,
            cause: Cause.stripFailures(exit.cause),
          } satisfies EffectDefectEnvelope
        })
        .then((value) => resume(Effect.succeed(value)))
        .catch((thrown: unknown) => {
          // Typed failure — re-surface as Effect.fail
          if (
            thrown != null &&
            typeof thrown === "object" &&
            "__effectFailure" in thrown
          ) {
            resume(Effect.fail((thrown as EffectFailureEnvelope).error as E))
            return
          }

          // Defect from inner effect — re-die so it propagates correctly
          if (
            thrown != null &&
            typeof thrown === "object" &&
            "__effectDefect" in thrown
          ) {
            resume(Effect.die((thrown as EffectDefectEnvelope).cause))
            return
          }

          // Drizzle/PG error from the transaction wrapper itself
          resume(Effect.fail(classifyDatabaseError(thrown)))
        })
    })
  )
}
