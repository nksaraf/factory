import { eq, and } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { sshKey } from "../../db/schema/infra";

export async function listKeys(
  db: Database,
  filters?: { principalId?: string; status?: string }
) {
  let query = db.select().from(sshKey);
  if (filters?.principalId) {
    query = query.where(eq(sshKey.principalId, filters.principalId)) as typeof query;
  }
  if (filters?.status) {
    query = query.where(eq(sshKey.status, filters.status)) as typeof query;
  }
  return query;
}

export async function getKey(db: Database, id: string) {
  const rows = await db.select().from(sshKey).where(eq(sshKey.sshKeyId, id));
  return rows[0] ?? null;
}

export async function registerKey(
  db: Database,
  data: {
    principalId: string;
    name: string;
    publicKey: string;
    fingerprint: string;
    keyType?: string;
  }
) {
  const rows = await db.insert(sshKey).values(data).returning();
  return rows[0];
}

export async function revokeKey(db: Database, id: string) {
  const rows = await db
    .update(sshKey)
    .set({ status: "revoked" })
    .where(eq(sshKey.sshKeyId, id))
    .returning();
  return rows[0] ?? null;
}

export async function deleteKey(db: Database, id: string) {
  const rows = await db
    .delete(sshKey)
    .where(eq(sshKey.sshKeyId, id))
    .returning();
  return rows[0] ?? null;
}

export async function getActiveKeysForPrincipal(
  db: Database,
  principalId: string
) {
  return db
    .select()
    .from(sshKey)
    .where(
      and(eq(sshKey.principalId, principalId), eq(sshKey.status, "active"))
    );
}
