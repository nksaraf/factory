/**
 * SpecResolver service — resolves `$secret(key)` and `$var(key)` references
 * in JSONB spec objects.
 *
 * Deterministic, well-tested, swappable. Used everywhere an entity spec
 * references external credentials or configuration:
 *   - DNS sync (estate spec → provider credentials)
 *   - Identity sync (provider spec → OAuth tokens)
 *   - Git host service (provider spec → API tokens)
 *
 * Resolution rules:
 *   - `$secret(key)` → resolved via Secrets service
 *   - `$var(key)` → resolved via config var DB lookup
 *   - Plain strings → passed through unchanged
 *   - Non-string values → ignored
 *   - Unresolvable refs → null
 */

import { Context, Effect } from "effect"
import type { DatabaseError } from "../layers/database"
import type { SecretDecryptionError } from "./secrets"

export interface ResolveScope {
  readonly scopeType?: string
  readonly scopeId?: string
  readonly environment?: string
}

export class SpecResolver extends Context.Tag("SpecResolver")<
  SpecResolver,
  {
    /**
     * Resolve all `$secret()` and `$var()` references in a spec object.
     * Returns a new object with concrete values (original not mutated).
     */
    readonly resolve: <T extends Record<string, unknown>>(
      spec: T,
      scope?: ResolveScope
    ) => Effect.Effect<T, DatabaseError | SecretDecryptionError>
  }
>() {}
