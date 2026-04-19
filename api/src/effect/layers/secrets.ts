/**
 * Live layer for the Secrets service.
 *
 * Wraps PostgresSecretBackend, routing database errors through
 * classifyDatabaseError and crypto failures to SecretDecryptionError.
 */

import { Effect, Layer } from "effect"
import { Secrets, SecretDecryptionError } from "../services/secrets"
import { Db, DatabaseError, classifyDatabaseError } from "./database"
import { PostgresSecretBackend } from "../../lib/secrets/postgres-backend"

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
    }
  })
)
