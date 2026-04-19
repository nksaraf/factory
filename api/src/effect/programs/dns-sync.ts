/**
 * Effect program for DNS zone sync.
 *
 * Lifts the existing syncDnsFromEstate into Effect with:
 *   - Db from context (not passed manually)
 *   - Estate existence check with EntityNotFoundError
 *   - Database errors classified as DatabaseError
 *
 * The inner sync logic stays in services/infra/dns-sync.service.ts.
 * As that service gets incrementally ported, this program absorbs it.
 */

import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { estate } from "../../db/schema/infra"
import {
  Db,
  query,
  queryOrNotFound,
  type DatabaseError,
} from "../layers/database"
import { syncDnsFromEstate as syncDnsLegacy } from "../../services/infra/dns-sync.service"
import type { SyncResult } from "../../services/infra/dns-sync.service"
import { classifyDatabaseError } from "../layers/database"
import type { EntityNotFoundError } from "@smp/factory-shared/effect/errors"

/**
 * Sync DNS zones from an estate.
 *
 * Validates the estate exists, then delegates to the legacy sync function.
 * Requires: Db
 */
export function syncDnsFromEstate(
  estateId: string
): Effect.Effect<SyncResult, DatabaseError | EntityNotFoundError, Db> {
  return Effect.gen(function* () {
    const db = yield* Db

    // Verify estate exists — fails with EntityNotFoundError if missing
    yield* queryOrNotFound(
      db.select().from(estate).where(eq(estate.id, estateId)).limit(1),
      "estate",
      estateId
    )

    // Delegate to legacy sync (it does its own DB + adapter work internally)
    return yield* Effect.tryPromise({
      try: () => syncDnsLegacy(db, estateId),
      catch: classifyDatabaseError,
    })
  })
}
