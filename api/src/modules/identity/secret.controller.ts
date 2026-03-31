import { Elysia, t } from "elysia"
import { eq, and, or, inArray, isNull } from "drizzle-orm"

import type { Database } from "../../db/connection"
import { orgSecret } from "../../db/schema/org"
import { encrypt, decrypt } from "../../lib/secrets/crypto"

// ---------------------------------------------------------------------------
// Elysia models
// ---------------------------------------------------------------------------

const SecretBody = t.Object({
  key: t.String(),
  value: t.String(),
  scopeType: t.Optional(t.String()),
  scopeId: t.Optional(t.Union([t.String(), t.Null()])),
  environment: t.Optional(t.Union([t.String(), t.Null()])),
})

const ScopeQuery = t.Object({
  scopeType: t.Optional(t.String()),
  scopeId: t.Optional(t.String()),
  environment: t.Optional(t.String()),
})

const ResolveBody = t.Object({
  teamId: t.Optional(t.Union([t.String(), t.Null()])),
  projectId: t.Optional(t.Union([t.String(), t.Null()])),
  environment: t.Optional(t.Union([t.String(), t.Null()])),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scopeCondition(
  scopeType: string,
  scopeId: string | null | undefined,
  environment: string | null | undefined,
) {
  const conditions = [eq(orgSecret.scopeType, scopeType)]
  if (scopeId) {
    conditions.push(eq(orgSecret.scopeId, scopeId))
  } else {
    conditions.push(isNull(orgSecret.scopeId))
  }
  if (environment) {
    conditions.push(eq(orgSecret.environment, environment))
  } else {
    conditions.push(isNull(orgSecret.environment))
  }
  return and(...conditions)
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export function secretController(db: Database) {
  return new Elysia()

    // --- Set (upsert) ---
    .post("/secrets", async ({ body }) => {
      const { key, value, scopeType = "org", scopeId, environment } = body
      const enc = encrypt(value)

      // Try update first
      const existing = await db
        .select({ secretId: orgSecret.secretId })
        .from(orgSecret)
        .where(
          and(
            eq(orgSecret.key, key),
            scopeCondition(scopeType, scopeId, environment),
          ),
        )
        .limit(1)

      if (existing.length > 0) {
        await db
          .update(orgSecret)
          .set({
            encryptedValue: enc.ciphertext,
            iv: enc.iv,
            authTag: enc.authTag,
            updatedAt: new Date(),
          })
          .where(eq(orgSecret.secretId, existing[0]!.secretId))
      } else {
        await db.insert(orgSecret).values({
          key,
          encryptedValue: enc.ciphertext,
          iv: enc.iv,
          authTag: enc.authTag,
          scopeType,
          scopeId: scopeId ?? null,
          environment: environment ?? null,
        })
      }

      return { success: true }
    }, {
      body: SecretBody,
      detail: { tags: ["Secrets"], summary: "Set a secret" },
    })

    // --- Get ---
    .get("/secrets/:key", async ({ params, query, set }) => {
      const scopeType = query.scopeType ?? "org"
      const rows = await db
        .select()
        .from(orgSecret)
        .where(
          and(
            eq(orgSecret.key, params.key),
            scopeCondition(scopeType, query.scopeId, query.environment),
          ),
        )
        .limit(1)

      if (rows.length === 0) {
        set.status = 404
        return { success: false, error: "not_found" }
      }

      const row = rows[0]!
      const value = decrypt({
        ciphertext: row.encryptedValue,
        iv: row.iv,
        authTag: row.authTag,
      })

      return { success: true, value }
    }, {
      params: t.Object({ key: t.String() }),
      query: ScopeQuery,
      detail: { tags: ["Secrets"], summary: "Get a secret" },
    })

    // --- List (metadata only) ---
    .get("/secrets", async ({ query }) => {
      const scopeType = query.scopeType ?? "org"
      const conditions = [eq(orgSecret.scopeType, scopeType)]
      if (query.scopeId) {
        conditions.push(eq(orgSecret.scopeId, query.scopeId))
      }
      if (query.environment) {
        conditions.push(eq(orgSecret.environment, query.environment))
      }

      const rows = await db
        .select({
          key: orgSecret.key,
          scopeType: orgSecret.scopeType,
          scopeId: orgSecret.scopeId,
          environment: orgSecret.environment,
          updatedAt: orgSecret.updatedAt,
        })
        .from(orgSecret)
        .where(and(...conditions))

      return { success: true, secrets: rows }
    }, {
      query: ScopeQuery,
      detail: { tags: ["Secrets"], summary: "List secrets" },
    })

    // --- Delete ---
    .delete("/secrets/:key", async ({ params, query, set }) => {
      const scopeType = query.scopeType ?? "org"
      const rows = await db
        .delete(orgSecret)
        .where(
          and(
            eq(orgSecret.key, params.key),
            scopeCondition(scopeType, query.scopeId, query.environment),
          ),
        )
        .returning({ secretId: orgSecret.secretId })

      if (rows.length === 0) {
        set.status = 404
        return { success: false, error: "not_found" }
      }

      return { success: true }
    }, {
      params: t.Object({ key: t.String() }),
      query: ScopeQuery,
      detail: { tags: ["Secrets"], summary: "Delete a secret" },
    })

    // --- Resolve (merge all scopes for a context) ---
    .post("/secrets/resolve", async ({ body }) => {
      const { teamId, projectId, environment } = body

      // Build OR conditions for each scope level
      const scopeConditions = [
        // Org-wide secrets
        and(eq(orgSecret.scopeType, "org"), isNull(orgSecret.scopeId)),
      ]

      if (teamId) {
        scopeConditions.push(
          and(eq(orgSecret.scopeType, "team"), eq(orgSecret.scopeId, teamId)),
        )
      }
      if (projectId) {
        scopeConditions.push(
          and(eq(orgSecret.scopeType, "project"), eq(orgSecret.scopeId, projectId)),
        )
      }

      // Also match environment-scoped secrets at any level
      if (environment) {
        scopeConditions.push(eq(orgSecret.environment, environment))
      }

      const rows = await db
        .select()
        .from(orgSecret)
        .where(or(...scopeConditions))

      // Merge with precedence: org < team < project, and non-env < env
      const SCOPE_PRIORITY: Record<string, number> = {
        org: 0,
        team: 1,
        project: 2,
        environment: 3,
      }

      const merged = new Map<string, { value: string; priority: number }>()

      for (const row of rows) {
        const value = decrypt({
          ciphertext: row.encryptedValue,
          iv: row.iv,
          authTag: row.authTag,
        })

        let priority = SCOPE_PRIORITY[row.scopeType] ?? 0
        // Environment-specific secrets get a +10 boost within their scope level
        if (row.environment && row.environment === environment) {
          priority += 10
        }

        const existing = merged.get(row.key)
        if (!existing || priority > existing.priority) {
          merged.set(row.key, { value, priority })
        }
      }

      const secrets = Array.from(merged.entries()).map(([key, { value }]) => ({
        key,
        value,
      }))

      return { success: true, secrets }
    }, {
      body: ResolveBody,
      detail: { tags: ["Secrets"], summary: "Resolve all secrets for a context" },
    })
}
