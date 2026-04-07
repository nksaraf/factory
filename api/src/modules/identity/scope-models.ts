/**
 * Shared scope models and resolve logic for config vars and secrets.
 *
 * Scope hierarchy (low → high priority):
 *   system(0) < org(1) < team(2) < project(3) < principal(4)
 *
 * Environment is orthogonal — env-specific entries get a +10 bonus
 * over 'all' within the same scope level.
 */

import { t } from "elysia"
import { eq, and, or, inArray } from "drizzle-orm"
import type { Column } from "drizzle-orm"

// ---------------------------------------------------------------------------
// Valid scope types
// ---------------------------------------------------------------------------

export const VALID_SCOPE_TYPES = ["org", "team", "project", "principal", "system"] as const
export type ScopeType = (typeof VALID_SCOPE_TYPES)[number]

// ---------------------------------------------------------------------------
// Elysia models (shared between config-var and secret controllers)
// ---------------------------------------------------------------------------

export const ScopeQuery = t.Object({
  scopeType: t.Optional(t.String()),
  scopeId: t.Optional(t.String()),
  environment: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  offset: t.Optional(t.String()),
})

export const ResolveBody = t.Object({
  teamId: t.Optional(t.Union([t.String(), t.Null()])),
  projectId: t.Optional(t.Union([t.String(), t.Null()])),
  principalId: t.Optional(t.Union([t.String(), t.Null()])),
  environment: t.Optional(t.Union([t.String(), t.Null()])),
})

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate scopeType. Returns an error string if invalid, undefined if ok.
 */
export function validateScopeType(scopeType: string | undefined): string | undefined {
  if (scopeType && !(VALID_SCOPE_TYPES as readonly string[]).includes(scopeType)) {
    return `Invalid scopeType "${scopeType}". Must be one of: ${VALID_SCOPE_TYPES.join(", ")}`
  }
}

// ---------------------------------------------------------------------------
// Scope priority
// ---------------------------------------------------------------------------

export const SCOPE_PRIORITY: Record<string, number> = {
  system: 0,
  org: 1,
  team: 2,
  project: 3,
  principal: 4,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a WHERE condition matching exact scope + environment.
 * Works with any table that has scopeType/scopeId/environment columns.
 */
export function scopeCondition(
  cols: { scopeType: Column; scopeId: Column; environment: Column },
  scopeType: string,
  scopeId: string,
  environment: string,
) {
  return and(
    eq(cols.scopeType, scopeType),
    eq(cols.scopeId, scopeId),
    eq(cols.environment, environment),
  )
}

/**
 * Build OR conditions for all relevant scope levels in a resolve query.
 */
export function buildResolveScopeConditions(
  cols: { scopeType: Column; scopeId: Column },
  body: { teamId?: string | null; projectId?: string | null; principalId?: string | null },
) {
  const conditions = [
    and(eq(cols.scopeType, "system"), eq(cols.scopeId, "default")),
    and(eq(cols.scopeType, "org"), eq(cols.scopeId, "default")),
  ]
  if (body.teamId) {
    conditions.push(and(eq(cols.scopeType, "team"), eq(cols.scopeId, body.teamId)))
  }
  if (body.projectId) {
    conditions.push(and(eq(cols.scopeType, "project"), eq(cols.scopeId, body.projectId)))
  }
  if (body.principalId) {
    conditions.push(and(eq(cols.scopeType, "principal"), eq(cols.scopeId, body.principalId)))
  }
  return conditions
}

/**
 * Build environment filter condition for resolve queries.
 */
export function buildEnvCondition(
  envCol: Column,
  environment?: string | null,
) {
  return environment
    ? inArray(envCol, ["all", environment])
    : eq(envCol, "all")
}

/**
 * Merge rows with scope priority. Returns a Map of slug → value,
 * with higher-priority scopes overriding lower ones, and env-specific
 * entries getting a +10 bonus over 'all'.
 */
export function mergeWithScopePriority<T extends { scopeType: string; environment: string }>(
  rows: T[],
  environment: string | null | undefined,
  getSlug: (row: T) => string,
  getValue: (row: T) => string,
): Map<string, string> {
  const merged = new Map<string, { value: string; priority: number }>()

  for (const row of rows) {
    let priority = SCOPE_PRIORITY[row.scopeType] ?? 0
    if (row.environment !== "all" && row.environment === environment) {
      priority += 10
    }

    const slug = getSlug(row)
    const existing = merged.get(slug)
    if (!existing || priority > existing.priority) {
      merged.set(slug, { value: getValue(row), priority })
    }
  }

  return new Map(Array.from(merged.entries()).map(([k, { value }]) => [k, value]))
}
