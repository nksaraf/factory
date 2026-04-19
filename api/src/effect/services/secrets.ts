/**
 * Secrets service tag for Effect programs.
 *
 * Mirrors the SecretBackend interface but returns Effects with typed errors.
 */

import { Context, Data, Effect } from "effect"
import type {
  SecretEntry,
  SetSecretParams,
  GetSecretParams,
  ListSecretsParams,
  ListSecretEntry,
  ResolveSecretsParams,
} from "../../lib/secrets/secret-backend"
import type { DatabaseError } from "../layers/database"

// ---------------------------------------------------------------------------
// Domain-specific errors
// ---------------------------------------------------------------------------

export class SecretDecryptionError extends Data.TaggedError(
  "SecretDecryptionError"
)<{
  readonly key: string
  readonly message: string
}> {
  get httpStatus(): number {
    return 500
  }
}

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class Secrets extends Context.Tag("Secrets")<
  Secrets,
  {
    readonly set: (
      params: SetSecretParams
    ) => Effect.Effect<void, DatabaseError>
    readonly get: (
      params: GetSecretParams
    ) => Effect.Effect<string | null, DatabaseError | SecretDecryptionError>
    readonly list: (
      params: ListSecretsParams
    ) => Effect.Effect<ListSecretEntry[], DatabaseError>
    readonly remove: (
      params: GetSecretParams
    ) => Effect.Effect<boolean, DatabaseError>
    readonly resolve: (
      params: ResolveSecretsParams
    ) => Effect.Effect<SecretEntry[], DatabaseError | SecretDecryptionError>
  }
>() {}
