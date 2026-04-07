/**
 * Generic slug/ID resolution helpers.
 * Generalizes the EntityFinder pattern for any Drizzle table.
 */

import { and, eq, or, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Database } from "../db/connection";

/**
 * Checks if a string matches the prefixed CUID pattern used by newId().
 * Example: "sys_clx1234...", "cmp_clx5678..."
 *
 * Pattern: 1-6 lowercase alpha chars, underscore, then 24+ alphanumeric chars.
 */
export function isPrefixedId(value: string): boolean {
  return /^[a-z]{1,6}_[a-z0-9]{24,}$/.test(value);
}

/**
 * Resolve an entity by slug or ID. Tries slug first, falls back to ID.
 *
 * Issues a single query with OR(slug = value, id = value) limited to 2 rows.
 * If both match (unlikely but possible), disambiguates using isPrefixedId:
 * - If the input looks like an ID, prefer the ID match
 * - Otherwise, prefer the slug match
 *
 * @param extraFilter Optional additional WHERE clause (e.g. bitemporal currentRow filter).
 *
 * @example
 *   const system = await resolveBySlugOrId(db, softwareSystem, "iam", softwareSystem.slug, softwareSystem.id);
 */
export async function resolveBySlugOrId<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  db: Database,
  table: PgTable,
  slugOrId: string,
  slugColumn: PgColumn,
  idColumn: PgColumn,
  extraFilter?: SQL,
): Promise<T | null> {
  const match = or(eq(slugColumn, slugOrId), eq(idColumn, slugOrId));
  const where = extraFilter ? and(match, extraFilter) : match;

  const rows = await db
    .select()
    .from(table)
    .where(where)
    .limit(2);

  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0] as T;

  // Two rows matched — disambiguate
  const looksLikeId = isPrefixedId(slugOrId);
  const found = rows.find((row) => {
    const col = looksLikeId ? idColumn.name : slugColumn.name;
    return (row as Record<string, unknown>)[col] === slugOrId;
  });

  return (found ?? rows[0]) as T;
}
