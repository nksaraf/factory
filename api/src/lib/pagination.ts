/**
 * Shared pagination helpers.
 * Replaces per-module manual limit/offset handling.
 */

import { count, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Database } from "../db/connection";

// ── Types ───────────────────────────────────────────────────

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface PaginationMeta {
  total: number;
  limit: number;
  offset: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

// ── Constants ───────────────────────────────────────────────

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

// ── Helpers ─────────────────────────────────────────────────

/**
 * Parse and clamp pagination params.
 * - limit: clamped to [1, MAX_LIMIT], defaults to DEFAULT_LIMIT
 * - offset: clamped to >= 0, defaults to 0
 */
export function parsePagination(params: PaginationParams): {
  limit: number;
  offset: number;
} {
  const limit = Math.min(
    Math.max(params.limit ?? DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );
  const offset = Math.max(params.offset ?? 0, 0);
  return { limit, offset };
}

/**
 * Count total rows in a table, optionally filtered by a WHERE clause.
 */
export async function countRows(
  db: Database,
  table: PgTable,
  where?: SQL,
): Promise<number> {
  const result = await db
    .select({ count: count() })
    .from(table)
    .where(where);
  return result[0]?.count ?? 0;
}

/**
 * Convenience builder for PaginationMeta.
 */
export function paginationMeta(
  total: number,
  parsed: { limit: number; offset: number },
): PaginationMeta {
  return { total, limit: parsed.limit, offset: parsed.offset };
}
