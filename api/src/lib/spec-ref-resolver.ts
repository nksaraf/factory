/**
 * Resolve `$secret(key)` and `$var(key)` references in a JSONB spec object.
 *
 * Any string value in the spec matching `$secret(key)` is resolved via
 * SecretBackend.get(). Any string matching `$var(key)` is resolved via
 * a configVar lookup. Plain strings pass through unchanged.
 *
 * Only top-level string values are resolved (no deep nesting).
 */

import { eq, and } from "drizzle-orm";
import type { Database } from "../db/connection";
import type { SecretBackend } from "./secrets/secret-backend";
import { configVar } from "../db/schema/org-v2";

const SECRET_REF = /^\$secret\(([^)]+)\)$/;
const VAR_REF = /^\$var\(([^)]+)\)$/;

export interface SpecRefResolver {
  resolve<T extends Record<string, unknown>>(spec: T): Promise<T>;
}

export function createSpecRefResolver(
  db: Database,
  secrets: SecretBackend,
  scope?: { scopeType?: string; scopeId?: string },
): SpecRefResolver {
  return {
    async resolve<T extends Record<string, unknown>>(spec: T): Promise<T> {
      const result = { ...spec };

      for (const [key, value] of Object.entries(result)) {
        if (typeof value !== "string") continue;

        const secretMatch = value.match(SECRET_REF);
        if (secretMatch) {
          const resolved = await secrets.get({
            key: secretMatch[1],
            scopeType: scope?.scopeType ?? "org",
            scopeId: scope?.scopeId,
          });
          (result as Record<string, unknown>)[key] = resolved;
          continue;
        }

        const varMatch = value.match(VAR_REF);
        if (varMatch) {
          const slug = varMatch[1];
          const conditions = [eq(configVar.slug, slug)];
          if (scope?.scopeType) {
            conditions.push(eq(configVar.scopeType, scope.scopeType));
          }
          if (scope?.scopeId) {
            conditions.push(eq(configVar.scopeId, scope.scopeId));
          }

          const [row] = await db
            .select({ value: configVar.value })
            .from(configVar)
            .where(and(...conditions))
            .limit(1);

          (result as Record<string, unknown>)[key] = row?.value ?? null;
          continue;
        }

        // Plain string — pass through
      }

      return result;
    },
  };
}
