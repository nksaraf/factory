import { generateKeyBetween } from "fractional-indexing"

/**
 * Compute a sort key that orders between `after` and `before`.
 *
 *   generateSortKeyBetween("a0", "a1") → key where "a0" < key < "a1"
 *   generateSortKeyBetween(null, "a0") → key < "a0"   (insert at start)
 *   generateSortKeyBetween("a2", null) → key > "a2"   (insert at end)
 *   generateSortKeyBetween(null, null) → first key     (empty list)
 */
export function generateSortKeyBetween(
  after: string | null | undefined,
  before: string | null | undefined
): string {
  return generateKeyBetween(after ?? null, before ?? null)
}

/**
 * Compare two sort keys using plain lexicographic (byte) order.
 *
 * IMPORTANT: fractional-indexing generates keys that use both uppercase and
 * lowercase characters. `String.localeCompare()` is NOT safe because locale
 * rules treat "Zz" > "a0", but plain `<` correctly gives "Zz" < "a0".
 * Always use this comparator (or plain `<` / `>`) when ordering by sortKey.
 */
export function compareSortKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
