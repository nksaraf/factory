/**
 * Postgres-backed secret storage using Drizzle ORM.
 *
 * Secrets are encrypted at rest with AES-256-GCM via the crypto module.
 * Resolution follows Vercel-style precedence: org < team < project,
 * with environment-specific secrets overriding non-environment ones.
 */

import { and, eq, or } from "drizzle-orm";

import type { Database } from "../../db/connection";
import { secret } from "../../db/schema/org-v2";
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
  const conditions = [
    eq(secret.scopeType, scopeType),
    eq(secret.scopeId, scopeId ?? ""),
    eq(secret.environment, environment ?? "all"),
  ];
  return and(...conditions);
}

export class PostgresSecretBackend implements SecretBackend {
  constructor(private db: Database) {}

  async set(params: SetSecretParams): Promise<void> {
    const enc = encrypt(params.value);

    const existing = await this.db
      .select({ id: secret.id })
      .from(secret)
      .where(
        and(
          eq(secret.slug, params.key),
          scopeCondition(params.scopeType, params.scopeId, params.environment),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await this.db
        .update(secret)
        .set({
          encryptedValue: enc.ciphertext,
          iv: enc.iv,
          authTag: enc.authTag,
          updatedAt: new Date(),
        })
        .where(eq(secret.id, existing[0]!.id));
    } else {
      await this.db.insert(secret).values({
        slug: params.key,
        name: params.key,
        encryptedValue: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        scopeType: params.scopeType,
        scopeId: params.scopeId ?? "",
        environment: params.environment ?? "all",
        createdBy: params.createdBy ?? null,
      });
    }
  }

  async get(params: GetSecretParams): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(secret)
      .where(
        and(
          eq(secret.slug, params.key),
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
    const conditions = [eq(secret.scopeType, params.scopeType)];
    if (params.scopeId) {
      conditions.push(eq(secret.scopeId, params.scopeId));
    }
    if (params.environment) {
      conditions.push(eq(secret.environment, params.environment));
    }

    return this.db
      .select({
        key: secret.slug,
        scopeType: secret.scopeType,
        scopeId: secret.scopeId,
        environment: secret.environment,
        updatedAt: secret.updatedAt,
      })
      .from(secret)
      .where(and(...conditions));
  }

  async remove(params: GetSecretParams): Promise<boolean> {
    const rows = await this.db
      .delete(secret)
      .where(
        and(
          eq(secret.slug, params.key),
          scopeCondition(params.scopeType, params.scopeId, params.environment),
        ),
      )
      .returning({ id: secret.id });

    return rows.length > 0;
  }

  async resolve(params: ResolveSecretsParams): Promise<SecretEntry[]> {
    const scopeConditions = [
      and(eq(secret.scopeType, "org"), eq(secret.scopeId, "")),
    ];

    if (params.teamId) {
      scopeConditions.push(
        and(eq(secret.scopeType, "team"), eq(secret.scopeId, params.teamId)),
      );
    }
    if (params.projectId) {
      scopeConditions.push(
        and(eq(secret.scopeType, "project"), eq(secret.scopeId, params.projectId)),
      );
    }
    if (params.environment) {
      scopeConditions.push(eq(secret.environment, params.environment));
    }

    const rows = await this.db
      .select()
      .from(secret)
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

      const existing = merged.get(row.slug);
      if (!existing || priority > existing.priority) {
        merged.set(row.slug, { value, priority });
      }
    }

    return Array.from(merged.entries()).map(([key, { value }]) => ({
      key,
      value,
    }));
  }
}
