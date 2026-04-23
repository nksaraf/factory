/**
 * Secrets service tag for Effect programs.
 *
 * Provides two resolution modes:
 *   1. Direct — set/get/list/remove by explicit scope (scopeType + scopeId)
 *   2. Entity — resolveForEntity walks the ontology ancestry chain to merge
 *      secrets from all parent scopes with proper precedence
 *
 * Secret inheritance (most specific wins):
 *   component-deployment → system-deployment → site → component → system → org
 *   host → estate → estate (recursive) → org
 *   team → team (recursive) → org
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
import type { EntityNotFoundError } from "@smp/factory-shared/effect/errors"

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
    // ── Direct scope operations ────────────────────────────
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

    // ── Entity-scoped resolution ──────────────────────────
    /**
     * Resolve all secrets for a scope chain (from ontology.secretScopeChain).
     *
     * Queries secrets at each scope level and merges with most specific winning.
     * The caller provides the chain — typically from `graph.secretScopeChain()`.
     *
     * @example
     * ```ts
     * const graph = yield* Graph
     * const secrets = yield* Secrets
     * const chain = yield* graph.secretScopeChain("system-deployment", "api-prod")
     * const resolved = yield* secrets.resolveForScopeChain(chain)
     * ```
     */
    readonly resolveForScopeChain: (
      scopeChain: Array<{ scopeType: string; scopeId: string }>,
      environment?: string
    ) => Effect.Effect<SecretEntry[], DatabaseError | SecretDecryptionError>
  }
>() {}
