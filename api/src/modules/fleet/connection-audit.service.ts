import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { connectionAuditEvent } from "../../db/schema/ops";

// ---------------------------------------------------------------------------
// Connection Audit Events — v2: spec JSONB
// ---------------------------------------------------------------------------

export async function createConnectionAuditEvent(
  db: Database,
  input: {
    principalId: string;
    systemDeploymentId?: string;
    deploymentTargetId?: string;
    connectedResources: Record<string, unknown>;
    readonly: boolean;
    reason?: string;
  },
) {
  const [row] = await db
    .insert(connectionAuditEvent)
    .values({
      systemDeploymentId: input.systemDeploymentId ?? input.deploymentTargetId,
      spec: {
        principalId: input.principalId,
        connectedResources: input.connectedResources,
        readonly: input.readonly,
        reason: input.reason,
        startedAt: new Date().toISOString(),
      } as any,
    })
    .returning();

  return row;
}

export async function endConnectionAuditEvent(db: Database, eventId: string) {
  const [existing] = await db
    .select()
    .from(connectionAuditEvent)
    .where(eq(connectionAuditEvent.id, eventId))
    .limit(1);

  if (!existing) throw new Error(`Connection audit event not found: ${eventId}`);

  const [updated] = await db
    .update(connectionAuditEvent)
    .set({
      spec: {
        ...(existing.spec as any),
        endedAt: new Date().toISOString(),
      } as any,
    })
    .where(eq(connectionAuditEvent.id, eventId))
    .returning();

  return updated;
}

export async function listConnectionAuditEvents(
  db: Database,
  opts?: {
    systemDeploymentId?: string;
    deploymentTargetId?: string;
    principalId?: string;
  },
) {
  const sdId = opts?.systemDeploymentId ?? opts?.deploymentTargetId;
  const conditions = [];
  if (sdId) conditions.push(eq(connectionAuditEvent.systemDeploymentId, sdId));

  const base = db.select().from(connectionAuditEvent);
  const rows =
    conditions.length > 0
      ? await base.where(and(...conditions)).orderBy(desc(connectionAuditEvent.createdAt))
      : await base.orderBy(desc(connectionAuditEvent.createdAt));

  if (opts?.principalId) {
    const filtered = rows.filter(
      (r) => (r.spec as any)?.principalId === opts.principalId,
    );
    return { data: filtered, total: filtered.length };
  }

  return { data: rows, total: rows.length };
}
