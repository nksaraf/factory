import { Elysia, t } from "elysia"
import { eq, and, or } from "drizzle-orm"

import type { Database } from "../../db/connection"
import { configVar } from "../../db/schema/org"
import {
  ScopeQuery,
  ResolveBody,
  scopeCondition,
  buildResolveScopeConditions,
  buildEnvCondition,
  mergeWithScopePriority,
  validateScopeType,
} from "./scope-models"

// ---------------------------------------------------------------------------
// Elysia models
// ---------------------------------------------------------------------------

const ConfigVarBody = t.Object({
  slug: t.String(),
  name: t.Optional(t.String()),
  value: t.String(),
  scopeType: t.Optional(t.String()),
  scopeId: t.Optional(t.String()),
  environment: t.Optional(t.String()),
  spec: t.Optional(t.Any()),
})

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export function configVarController(db: Database) {
  const cols = {
    scopeType: configVar.scopeType,
    scopeId: configVar.scopeId,
    environment: configVar.environment,
  }

  return (
    new Elysia()

      // --- Set (upsert) ---
      .post(
        "/vars",
        async ({ body, set }) => {
          const {
            slug,
            name,
            value,
            scopeType = "org",
            scopeId = "default",
            environment = "all",
            spec,
          } = body

          const err = validateScopeType(scopeType)
          if (err) {
            set.status = 400
            return { success: false, error: err }
          }

          await db
            .insert(configVar)
            .values({
              slug,
              name: name ?? slug,
              value,
              scopeType,
              scopeId,
              environment,
              ...(spec !== undefined ? { spec } : {}),
            })
            .onConflictDoUpdate({
              target: [
                configVar.slug,
                configVar.scopeType,
                configVar.scopeId,
                configVar.environment,
              ],
              set: {
                name: name ?? slug,
                value,
                ...(spec !== undefined ? { spec } : {}),
                updatedAt: new Date(),
              },
            })

          return { success: true }
        },
        {
          body: ConfigVarBody,
          detail: { tags: ["Config Vars"], summary: "Set a config variable" },
        }
      )

      // --- Get ---
      .get(
        "/vars/:slug",
        async ({ params, query, set }) => {
          const err = validateScopeType(query.scopeType)
          if (err) {
            set.status = 400
            return { success: false, error: err }
          }

          const st = query.scopeType ?? "org"
          const si = query.scopeId ?? "default"
          const env = query.environment ?? "all"

          const rows = await db
            .select()
            .from(configVar)
            .where(
              and(
                eq(configVar.slug, params.slug),
                scopeCondition(cols, st, si, env)
              )
            )
            .limit(1)

          if (rows.length === 0) {
            set.status = 404
            return { success: false, error: "not_found" }
          }

          const row = rows[0]!
          return {
            success: true,
            slug: row.slug,
            name: row.name,
            value: row.value,
            scopeType: row.scopeType,
            scopeId: row.scopeId,
            environment: row.environment,
            spec: row.spec,
            updatedAt: row.updatedAt,
          }
        },
        {
          params: t.Object({ slug: t.String() }),
          query: ScopeQuery,
          detail: { tags: ["Config Vars"], summary: "Get a config variable" },
        }
      )

      // --- List ---
      .get(
        "/vars",
        async ({ query, set }) => {
          const err = validateScopeType(query.scopeType)
          if (err) {
            set.status = 400
            return { success: false, error: err }
          }

          const scopeType = query.scopeType ?? "org"
          const conditions = [eq(configVar.scopeType, scopeType)]
          if (query.scopeId) {
            conditions.push(eq(configVar.scopeId, query.scopeId))
          }
          if (query.environment) {
            conditions.push(eq(configVar.environment, query.environment))
          }

          const limit = Math.min(
            parseInt(query.limit ?? "200", 10) || 200,
            1000
          )
          const offset = parseInt(query.offset ?? "0", 10) || 0

          const rows = await db
            .select({
              slug: configVar.slug,
              value: configVar.value,
              scopeType: configVar.scopeType,
              scopeId: configVar.scopeId,
              environment: configVar.environment,
              updatedAt: configVar.updatedAt,
            })
            .from(configVar)
            .where(and(...conditions))
            .limit(limit)
            .offset(offset)

          return { success: true, vars: rows }
        },
        {
          query: ScopeQuery,
          detail: { tags: ["Config Vars"], summary: "List config variables" },
        }
      )

      // --- Delete ---
      .delete(
        "/vars/:slug",
        async ({ params, query, set }) => {
          const err = validateScopeType(query.scopeType)
          if (err) {
            set.status = 400
            return { success: false, error: err }
          }

          const st = query.scopeType ?? "org"
          const si = query.scopeId ?? "default"
          const env = query.environment ?? "all"

          const rows = await db
            .delete(configVar)
            .where(
              and(
                eq(configVar.slug, params.slug),
                scopeCondition(cols, st, si, env)
              )
            )
            .returning({ id: configVar.id })

          if (rows.length === 0) {
            set.status = 404
            return { success: false, error: "not_found" }
          }

          return { success: true }
        },
        {
          params: t.Object({ slug: t.String() }),
          query: ScopeQuery,
          detail: {
            tags: ["Config Vars"],
            summary: "Delete a config variable",
          },
        }
      )

      // --- Resolve (merge all scopes for a context) ---
      .post(
        "/vars/resolve",
        async ({ body }) => {
          const { environment } = body

          const scopeConditions = buildResolveScopeConditions(cols, body)
          const envCondition = buildEnvCondition(cols.environment, environment)

          const rows = await db
            .select()
            .from(configVar)
            .where(and(or(...scopeConditions), envCondition))

          const merged = mergeWithScopePriority(
            rows,
            environment,
            (r) => r.slug,
            (r) => r.value
          )

          const vars = Array.from(merged.entries()).map(([slug, value]) => ({
            slug,
            value,
          }))

          return { success: true, vars }
        },
        {
          body: ResolveBody,
          detail: {
            tags: ["Config Vars"],
            summary: "Resolve all config variables for a context",
          },
        }
      )
  )
}
