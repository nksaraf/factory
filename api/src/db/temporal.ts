/**
 * Bitemporal query helpers.
 *
 * Conventions:
 * - valid_to IS NULL  → entity is currently valid (not soft-deleted)
 * - system_to IS NULL → this is the latest version of the record
 * - Both NULL         → the "live" current row
 */

import { sql, and, eq, isNull, lte, gt, or, type SQL } from "drizzle-orm"
import type { PgColumn, PgTable } from "drizzle-orm/pg-core"
import { getTableColumns } from "drizzle-orm"

import type { Database } from "./connection"

// ── Types ───────────────────────────────────────────────────

export interface BitemporalTable {
  validFrom: PgColumn
  validTo: PgColumn
  systemFrom: PgColumn
  systemTo: PgColumn
}

// ── Filters ─────────────────────────────────────────────────

/**
 * Filter for the current live row: valid now AND latest system version.
 * Use as the default baseFilter in CRUD routes for bitemporal tables.
 */
export function currentRow(
  table: Pick<BitemporalTable, "validTo" | "systemTo">
): SQL {
  return and(isNull(table.validTo), isNull(table.systemTo))!
}

/**
 * Filter for rows valid at a specific point in time.
 * Defaults to now() if no date is provided.
 */
export function validAt(
  table: Pick<BitemporalTable, "validFrom" | "validTo">,
  at: Date = new Date()
): SQL {
  return and(
    lte(table.validFrom, at),
    or(isNull(table.validTo), gt(table.validTo, at))
  )!
}

/**
 * Full bitemporal "as of" query: what was valid at `at` according to
 * the system's knowledge at that same time.
 */
export function asOf(table: BitemporalTable, at: Date): SQL {
  return and(
    lte(table.validFrom, at),
    or(isNull(table.validTo), gt(table.validTo, at)),
    lte(table.systemFrom, at),
    or(isNull(table.systemTo), gt(table.systemTo, at))
  )!
}

// ── Write helpers ───────────────────────────────────────────

/**
 * Column values for a simple soft-delete (just sets valid_to).
 * Prefer `bitemporalDelete()` for full time-travel correctness.
 */
export function softDeleteValues(changedByVal: string) {
  return {
    validTo: new Date(),
    changedBy: changedByVal,
    changeReason: "soft_delete",
  } as const
}

/**
 * Full bitemporal soft-delete in a transaction.
 *
 * Two-step process preserving system-time history:
 * 1. Close the current system version (set system_to = now)
 * 2. Insert a new row with the same data but valid_to = now
 *
 * This ensures asOf() queries correctly show the entity as "alive"
 * during the period between creation and deletion.
 */
export async function bitemporalDelete(
  db: Database,
  table: PgTable &
    BitemporalTable & {
      id: PgColumn
      changedBy: PgColumn
      changeReason: PgColumn
    },
  id: string,
  changedBy: string
): Promise<void> {
  const now = new Date()

  await db.transaction(async (tx) => {
    // 1. Find and lock the current live row
    const [current] = await tx
      .select()
      .from(table)
      .where(and(eq(table.id, id), currentRow(table)))
      .limit(1)
      .for("update")

    if (!current) return

    // 2. Close the current system version
    await tx
      .update(table)
      .set({ systemTo: now } as any)
      .where(and(eq(table.id, id), currentRow(table)))

    // 3. Insert a new row: same data, but valid_to = now (deleted) and fresh system_from.
    //    Omit the PK so that the table's $defaultFn generates a new unique id.
    const cols = getTableColumns(table)
    const newRow: Record<string, unknown> = {}
    const pkName = table.id.name
    for (const [key] of Object.entries(cols)) {
      if (key === pkName || key === "id") continue // skip PK — let $defaultFn generate a new one
      newRow[key] = (current as Record<string, unknown>)[key]
    }
    newRow.validTo = now
    newRow.systemFrom = now
    newRow.systemTo = null
    newRow.changedBy = changedBy
    newRow.changeReason = "soft_delete"

    await tx.insert(table).values(newRow as any)
  })
}

/**
 * Column values for closing the current system version
 * (used before inserting a corrected row).
 */
export function closeSystemVersion() {
  return {
    systemTo: new Date(),
  } as const
}
