import { Elysia, t } from "elysia"
import { eq, and, or } from "drizzle-orm"

import type { Database } from "../../db/connection"
import { secret } from "../../db/schema/org-v2"
import { encrypt, decrypt } from "../../lib/secrets/crypto"
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

const SecretBody = t.Object({
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

export function secretController(db: Database) {
  const cols = {
    scopeType: secret.scopeType,
    scopeId: secret.scopeId,
    environment: secret.environment,
  }

  return new Elysia()

    // --- Set (upsert) ---
    .post("/secrets", async ({ body, set }) => {
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
      if (err) { set.status = 400; return { success: false, error: err } }

      const enc = encrypt(value)

      await db.insert(secret).values({
        slug,
        name: name ?? slug,
        encryptedValue: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        keyVersion: enc.keyVersion ?? 1,
        scopeType,
        scopeId,
        environment,
        ...(spec !== undefined ? { spec } : {}),
      }).onConflictDoUpdate({
        target: [secret.slug, secret.scopeType, secret.scopeId, secret.environment],
        set: {
          name: name ?? slug,
          encryptedValue: enc.ciphertext,
          iv: enc.iv,
          authTag: enc.authTag,
          keyVersion: enc.keyVersion ?? 1,
          ...(spec !== undefined ? { spec } : {}),
          updatedAt: new Date(),
        },
      })

      return { success: true }
    }, {
      body: SecretBody,
      detail: { tags: ["Secrets"], summary: "Set a secret" },
    })

    // --- Get ---
    .get("/secrets/:slug", async ({ params, query, set }) => {
      const err = validateScopeType(query.scopeType)
      if (err) { set.status = 400; return { success: false, error: err } }

      const st = query.scopeType ?? "org"
      const si = query.scopeId ?? "default"
      const env = query.environment ?? "all"

      const rows = await db
        .select()
        .from(secret)
        .where(
          and(
            eq(secret.slug, params.slug),
            scopeCondition(cols, st, si, env),
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
        keyVersion: row.keyVersion,
      })

      return { success: true, value }
    }, {
      params: t.Object({ slug: t.String() }),
      query: ScopeQuery,
      detail: { tags: ["Secrets"], summary: "Get a secret" },
    })

    // --- List (metadata only, no values) ---
    .get("/secrets", async ({ query, set }) => {
      const err = validateScopeType(query.scopeType)
      if (err) { set.status = 400; return { success: false, error: err } }

      const scopeType = query.scopeType ?? "org"
      const conditions = [eq(secret.scopeType, scopeType)]
      if (query.scopeId) {
        conditions.push(eq(secret.scopeId, query.scopeId))
      }
      if (query.environment) {
        conditions.push(eq(secret.environment, query.environment))
      }

      const limit = Math.min(parseInt(query.limit ?? "200", 10) || 200, 1000)
      const offset = parseInt(query.offset ?? "0", 10) || 0

      const rows = await db
        .select({
          slug: secret.slug,
          scopeType: secret.scopeType,
          scopeId: secret.scopeId,
          environment: secret.environment,
          updatedAt: secret.updatedAt,
        })
        .from(secret)
        .where(and(...conditions))
        .limit(limit)
        .offset(offset)

      return { success: true, secrets: rows }
    }, {
      query: ScopeQuery,
      detail: { tags: ["Secrets"], summary: "List secrets" },
    })

    // --- Delete ---
    .delete("/secrets/:slug", async ({ params, query, set }) => {
      const err = validateScopeType(query.scopeType)
      if (err) { set.status = 400; return { success: false, error: err } }

      const st = query.scopeType ?? "org"
      const si = query.scopeId ?? "default"
      const env = query.environment ?? "all"

      const rows = await db
        .delete(secret)
        .where(
          and(
            eq(secret.slug, params.slug),
            scopeCondition(cols, st, si, env),
          ),
        )
        .returning({ id: secret.id })

      if (rows.length === 0) {
        set.status = 404
        return { success: false, error: "not_found" }
      }

      return { success: true }
    }, {
      params: t.Object({ slug: t.String() }),
      query: ScopeQuery,
      detail: { tags: ["Secrets"], summary: "Delete a secret" },
    })

    // --- Rotate (re-encrypt secrets with current or new key version) ---
    .post("/secrets/rotate", async ({ body, set }) => {
      const { slug, scopeType, scopeId, newKeyVersion } = body

      if (!slug && !scopeType) {
        set.status = 400
        return { success: false, error: "Must provide slug or scopeType to scope the rotation" }
      }

      const err = validateScopeType(scopeType)
      if (err) { set.status = 400; return { success: false, error: err } }

      const conditions = []
      if (slug) conditions.push(eq(secret.slug, slug))
      if (scopeType) conditions.push(eq(secret.scopeType, scopeType))
      if (scopeId) conditions.push(eq(secret.scopeId, scopeId))

      const rows = await db
        .select()
        .from(secret)
        .where(and(...conditions))

      let rotated = 0
      await db.transaction(async (tx) => {
        for (const row of rows) {
          const plaintext = decrypt({
            ciphertext: row.encryptedValue,
            iv: row.iv,
            authTag: row.authTag,
            keyVersion: row.keyVersion,
          })
          const enc = encrypt(plaintext, newKeyVersion)
          await tx
            .update(secret)
            .set({
              encryptedValue: enc.ciphertext,
              iv: enc.iv,
              authTag: enc.authTag,
              keyVersion: enc.keyVersion ?? 1,
              updatedAt: new Date(),
            })
            .where(eq(secret.id, row.id))
          rotated++
        }
      })

      return { success: true, rotated }
    }, {
      body: t.Object({
        slug: t.Optional(t.String()),
        scopeType: t.Optional(t.String()),
        scopeId: t.Optional(t.String()),
        newKeyVersion: t.Optional(t.Number()),
      }),
      detail: { tags: ["Secrets"], summary: "Re-encrypt secrets with the current (or specified) key version" },
    })

    // --- Resolve (merge all scopes for a context) ---
    .post("/secrets/resolve", async ({ body }) => {
      const { environment } = body

      const scopeConditions = buildResolveScopeConditions(cols, body)
      const envCondition = buildEnvCondition(cols.environment, environment)

      const rows = await db
        .select()
        .from(secret)
        .where(and(or(...scopeConditions), envCondition))

      const merged = mergeWithScopePriority(
        rows,
        environment,
        (r) => r.slug,
        (r) => decrypt({
          ciphertext: r.encryptedValue,
          iv: r.iv,
          authTag: r.authTag,
          keyVersion: r.keyVersion,
        }),
      )

      const secrets = Array.from(merged.entries()).map(([slug, value]) => ({
        slug,
        value,
      }))

      return { success: true, secrets }
    }, {
      body: ResolveBody,
      detail: { tags: ["Secrets"], summary: "Resolve all secrets for a context" },
    })
}
