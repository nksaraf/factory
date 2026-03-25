import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { sandboxAccess } from "../../db/schema/fleet";

export type SandboxAccessRole = "owner" | "editor" | "viewer";

export async function listAccess(db: Database, sandboxId: string) {
  return db
    .select()
    .from(sandboxAccess)
    .where(eq(sandboxAccess.sandboxId, sandboxId));
}

export async function grantAccess(
  db: Database,
  data: {
    sandboxId: string;
    principalId: string;
    principalType: "user" | "agent";
    role: SandboxAccessRole;
    grantedBy: string;
  }
) {
  const rows = await db
    .insert(sandboxAccess)
    .values(data)
    .onConflictDoUpdate({
      target: [sandboxAccess.sandboxId, sandboxAccess.principalId],
      set: { role: data.role, grantedBy: data.grantedBy },
    })
    .returning();
  return rows[0]!;
}

export async function revokeAccess(
  db: Database,
  sandboxId: string,
  principalId: string
) {
  // Cannot revoke owner access
  const rows = await db
    .select()
    .from(sandboxAccess)
    .where(
      and(
        eq(sandboxAccess.sandboxId, sandboxId),
        eq(sandboxAccess.principalId, principalId)
      )
    );

  const row = rows[0];
  if (!row) return;
  if (row.role === "owner") {
    throw new Error("Cannot revoke owner access");
  }

  await db
    .delete(sandboxAccess)
    .where(
      and(
        eq(sandboxAccess.sandboxId, sandboxId),
        eq(sandboxAccess.principalId, principalId)
      )
    );
}

export async function checkAccess(
  db: Database,
  sandboxId: string,
  principalId: string
): Promise<SandboxAccessRole | null> {
  const rows = await db
    .select()
    .from(sandboxAccess)
    .where(
      and(
        eq(sandboxAccess.sandboxId, sandboxId),
        eq(sandboxAccess.principalId, principalId)
      )
    );

  const row = rows[0];
  return row ? (row.role as SandboxAccessRole) : null;
}
