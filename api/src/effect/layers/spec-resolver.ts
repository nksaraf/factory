/**
 * SpecResolver live layer.
 *
 * Depends on: Db (for $var lookups), Secrets (for $secret lookups).
 *
 * Resolves top-level string values matching `$secret(key)` or `$var(key)`
 * in JSONB spec objects. Non-matching values pass through unchanged.
 */

import { Effect, Layer } from "effect"
import { eq, and } from "drizzle-orm"

import { SpecResolver, type ResolveScope } from "../services/spec-resolver"
import { Db, query } from "./database"
import { Secrets } from "../services/secrets"
import { configVar } from "../../db/schema/org"

const SECRET_REF = /^\$secret\(([^)]+)\)$/
const VAR_REF = /^\$var\(([^)]+)\)$/

export const SpecResolverLive = Layer.effect(
  SpecResolver,
  Effect.gen(function* () {
    const db = yield* Db
    const secrets = yield* Secrets

    return {
      resolve: <T extends Record<string, unknown>>(
        spec: T,
        scope?: ResolveScope
      ) =>
        Effect.gen(function* () {
          const result = { ...spec } as Record<string, unknown>

          for (const [key, value] of Object.entries(spec)) {
            if (typeof value !== "string") continue

            // $secret(key) → Secrets service
            const secretMatch = value.match(SECRET_REF)
            if (secretMatch) {
              result[key] = yield* secrets.get({
                key: secretMatch[1],
                scopeType: scope?.scopeType ?? "org",
                scopeId: scope?.scopeId ?? "default",
                environment: scope?.environment,
              })
              continue
            }

            // $var(key) → config var DB lookup
            const varMatch = value.match(VAR_REF)
            if (varMatch) {
              const slug = varMatch[1]
              const conditions = [eq(configVar.slug, slug)]
              if (scope?.scopeType) {
                conditions.push(eq(configVar.scopeType, scope.scopeType))
              }
              if (scope?.scopeId) {
                conditions.push(eq(configVar.scopeId, scope.scopeId))
              }

              const [row] = yield* query(
                db
                  .select({ value: configVar.value })
                  .from(configVar)
                  .where(and(...conditions))
                  .limit(1)
              )
              result[key] = row?.value ?? null
              continue
            }
          }

          return result as T
        }),
    }
  })
)
