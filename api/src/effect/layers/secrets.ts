/**
 * Live layer for the Secrets service.
 *
 * Wraps PostgresSecretBackend for direct operations, and adds
 * `resolveForEntity` which walks the graph ancestry chain
 * to merge secrets with proper scope precedence.
 */

import { Effect, Layer } from "effect"
import { and, eq, or } from "drizzle-orm"
import { Secrets, SecretDecryptionError } from "../services/secrets"
import { Db, DatabaseError, classifyDatabaseError, query } from "./database"
import { PostgresSecretBackend } from "../../lib/secrets/postgres-backend"
import { decrypt } from "../../lib/secrets/crypto"
import { secret } from "../../db/schema/org"
import type { SecretEntry } from "../../lib/secrets/secret-backend"

function classifySecretError(key: string) {
  return (err: unknown): SecretDecryptionError | DatabaseError => {
    if (
      err instanceof Error &&
      (err.message.includes("Unsupported state") ||
        err.message.includes("unable to authenticate") ||
        err.message.includes("Invalid key") ||
        err.message.includes("Invalid IV"))
    ) {
      return new SecretDecryptionError({ key, message: err.message })
    }
    return classifyDatabaseError(err)
  }
}

export const SecretsLive = Layer.effect(
  Secrets,
  Effect.gen(function* () {
    const db = yield* Db
    const backend = new PostgresSecretBackend(db)

    return {
      set: (params) =>
        Effect.tryPromise({
          try: () => backend.set(params),
          catch: classifyDatabaseError,
        }),

      get: (params) =>
        Effect.tryPromise({
          try: () => backend.get(params),
          catch: classifySecretError(params.key),
        }),

      list: (params) =>
        Effect.tryPromise({
          try: () => backend.list(params),
          catch: classifyDatabaseError,
        }),

      remove: (params) =>
        Effect.tryPromise({
          try: () => backend.remove(params),
          catch: classifyDatabaseError,
        }),

      resolve: (params) =>
        Effect.tryPromise({
          try: () => backend.resolve(params),
          catch: classifySecretError("*"),
        }),

      resolveForScopeChain: (scopeChain, environment) =>
        Effect.gen(function* () {
          // Query all secrets that match any scope in the chain
          const scopeConditions = scopeChain.map((scope) =>
            and(
              eq(secret.scopeType, scope.scopeType),
              eq(secret.scopeId, scope.scopeId)
            )
          )

          // Also include environment-specific and "all" environment secrets
          const envCondition = environment
            ? or(
                eq(secret.environment, environment),
                eq(secret.environment, "all")
              )
            : eq(secret.environment, "all")

          const rows = yield* query(
            db
              .select()
              .from(secret)
              .where(and(or(...scopeConditions), envCondition)) as any
          )

          // Merge with precedence: scopeChain order determines priority
          // Create a priority map: scope closest to the entity gets highest priority
          const scopePriority = new Map<string, number>()
          for (let i = 0; i < scopeChain.length; i++) {
            const key = `${scopeChain[i].scopeType}:${scopeChain[i].scopeId}`
            scopePriority.set(key, scopeChain.length - i) // higher = more specific
          }

          const merged = new Map<string, { value: string; priority: number }>()

          for (const row of rows as any[]) {
            const value = yield* Effect.tryPromise({
              try: () =>
                Promise.resolve(
                  decrypt({
                    ciphertext: row.encryptedValue,
                    iv: row.iv,
                    authTag: row.authTag,
                    keyVersion: row.keyVersion,
                  })
                ),
              catch: classifySecretError(row.slug),
            })

            const scopeKey = `${row.scopeType}:${row.scopeId}`
            let priority = scopePriority.get(scopeKey) ?? 0

            // Environment-specific secrets get a bonus over "all" environment
            if (environment && row.environment === environment) {
              priority += scopeChain.length + 1
            }

            const existing = merged.get(row.slug)
            if (!existing || priority > existing.priority) {
              merged.set(row.slug, { value, priority })
            }
          }

          return Array.from(merged.entries()).map(
            ([key, { value }]): SecretEntry => ({ key, value })
          )
        }),
    }
  })
)
