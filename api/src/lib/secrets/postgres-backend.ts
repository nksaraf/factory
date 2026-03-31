/**
 * Postgres-backed secret storage using Drizzle ORM.
 *
 * Secrets are encrypted at rest with AES-256-GCM via the crypto module.
 * Resolution follows Vercel-style precedence: org < team < project,
 * with environment-specific secrets overriding non-environment ones.
 */

import { and, eq, isNull, or } from "drizzle-orm";

import type { Database } from "../../db/connection";
import { orgSecret } from "../../db/schema/org";
import { encrypt, decrypt } from "./crypto";
import type {
  SecretBackend,
  SecretEntry,
  SetSecretParams,
  GetSecretParams,
  ListSecretsParams,
  ListSecretEntry,
  ResolveSecretsParams,
} from "./secret-backend";

function scopeCondition(
  scopeType: string,
  scopeId: string | null | undefined,
  environment: string | null | undefined,
) {
  const conditions = [eq(orgSecret.scopeType, scopeType)];
  if (scopeId) {
    conditions.push(eq(orgSecret.scopeId, scopeId));
  } else {
    conditions.push(isNull(orgSecret.scopeId));
  }
  if (environment) {
    conditions.push(eq(orgSecret.environment, environment));
  } else {
    conditions.push(isNull(orgSecret.environment));
  }
  return and(...conditions);
}

export class PostgresSecretBackend implements SecretBackend {
  constructor(private db: Database) {}

  async set(params: SetSecretParams): Promise<void> {
    const enc = encrypt(params.value);

    const existing = await this.db
      .select({ secretId: orgSecret.secretId })
      .from(orgSecret)
      .where(
        and(
          eq(orgSecret.key, params.key),
          scopeCondition(params.scopeType, params.scopeId, params.environment),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await this.db
        .update(orgSecret)
        .set({
          encryptedValue: enc.ciphertext,
          iv: enc.iv,
          authTag: enc.authTag,
          updatedAt: new Date(),
        })
        .where(eq(orgSecret.secretId, existing[0]!.secretId));
    } else {
      await this.db.insert(orgSecret).values({
        key: params.key,
        encryptedValue: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        scopeType: params.scopeType,
        scopeId: params.scopeId ?? null,
        environment: params.environment ?? null,
        createdBy: params.createdBy ?? null,
      });
    }
  }

  async get(params: GetSecretParams): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(orgSecret)
      .where(
        and(
          eq(orgSecret.key, params.key),
          scopeCondition(params.scopeType, params.scopeId, params.environment),
        ),
      )
      .limit(1);

    if (rows.length === 0) return null;

    const row = rows[0]!;
    return decrypt({
      ciphertext: row.encryptedValue,
      iv: row.iv,
      authTag: row.authTag,
    });
  }

  async list(params: ListSecretsParams): Promise<ListSecretEntry[]> {
    const conditions = [eq(orgSecret.scopeType, params.scopeType)];
    if (params.scopeId) {
      conditions.push(eq(orgSecret.scopeId, params.scopeId));
    }
    if (params.environment) {
      conditions.push(eq(orgSecret.environment, params.environment));
    }

    return this.db
      .select({
        key: orgSecret.key,
        scopeType: orgSecret.scopeType,
        scopeId: orgSecret.scopeId,
        environment: orgSecret.environment,
        updatedAt: orgSecret.updatedAt,
      })
      .from(orgSecret)
      .where(and(...conditions));
  }

  async remove(params: GetSecretParams): Promise<boolean> {
    const rows = await this.db
      .delete(orgSecret)
      .where(
        and(
          eq(orgSecret.key, params.key),
          scopeCondition(params.scopeType, params.scopeId, params.environment),
        ),
      )
      .returning({ secretId: orgSecret.secretId });

    return rows.length > 0;
  }

  async resolve(params: ResolveSecretsParams): Promise<SecretEntry[]> {
    const scopeConditions = [
      and(eq(orgSecret.scopeType, "org"), isNull(orgSecret.scopeId)),
    ];

    if (params.teamId) {
      scopeConditions.push(
        and(eq(orgSecret.scopeType, "team"), eq(orgSecret.scopeId, params.teamId)),
      );
    }
    if (params.projectId) {
      scopeConditions.push(
        and(eq(orgSecret.scopeType, "project"), eq(orgSecret.scopeId, params.projectId)),
      );
    }
    if (params.environment) {
      scopeConditions.push(eq(orgSecret.environment, params.environment));
    }

    const rows = await this.db
      .select()
      .from(orgSecret)
      .where(or(...scopeConditions));

    // Merge with precedence: org < team < project; non-env < env
    const SCOPE_PRIORITY: Record<string, number> = {
      org: 0,
      team: 1,
      project: 2,
      environment: 3,
    };

    const merged = new Map<string, { value: string; priority: number }>();

    for (const row of rows) {
      const value = decrypt({
        ciphertext: row.encryptedValue,
        iv: row.iv,
        authTag: row.authTag,
      });

      let priority = SCOPE_PRIORITY[row.scopeType] ?? 0;
      if (row.environment && row.environment === params.environment) {
        priority += 10;
      }

      const existing = merged.get(row.key);
      if (!existing || priority > existing.priority) {
        merged.set(row.key, { value, priority });
      }
    }

    return Array.from(merged.entries()).map(([key, { value }]) => ({
      key,
      value,
    }));
  }
}
