import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { rollout } from "../../db/schema/ops";
import { release } from "../../db/schema/software-v2";

// ---------------------------------------------------------------------------
// Rollout Management — v2: status → spec JSONB
// ---------------------------------------------------------------------------

const VALID_ROLLOUT_TRANSITIONS: Record<string, string[]> = {
  pending: ["in_progress"],
  in_progress: ["succeeded", "failed", "rolled_back"],
};

export async function createRollout(
  db: Database,
  input: {
    releaseId: string;
    systemDeploymentId?: string;
    deploymentTargetId?: string;
  },
) {
  const sdId = input.systemDeploymentId ?? input.deploymentTargetId!;

  const [rel] = await db.select().from(release).where(eq(release.id, input.releaseId)).limit(1);
  if (!rel) throw new Error(`Release not found: ${input.releaseId}`);

  const relStatus = (rel.spec as any)?.status ?? "draft";
  if (relStatus !== "staging" && relStatus !== "production") {
    throw new Error(
      `Release must be in 'staging' or 'production' status to create a rollout, got '${relStatus}'`,
    );
  }

  const [row] = await db
    .insert(rollout)
    .values({
      releaseId: input.releaseId,
      systemDeploymentId: sdId,
      spec: { status: "pending" } as any,
    })
    .returning();

  return row;
}

export async function getRollout(db: Database, id: string) {
  const [row] = await db.select().from(rollout).where(eq(rollout.id, id)).limit(1);
  if (!row) return null;

  const [rel] = row.releaseId
    ? await db.select().from(release).where(eq(release.id, row.releaseId)).limit(1)
    : [null];

  return {
    ...row,
    rolloutId: row.id,
    status: (row.spec as any)?.status,
    startedAt: (row.spec as any)?.startedAt,
    completedAt: (row.spec as any)?.completedAt,
    release: rel
      ? {
          releaseId: rel.id,
          version: (rel.spec as any)?.version,
          status: (rel.spec as any)?.status,
          createdAt: rel.createdAt,
        }
      : null,
  };
}

export async function updateRolloutStatus(db: Database, id: string, status: string) {
  const [existing] = await db.select().from(rollout).where(eq(rollout.id, id)).limit(1);
  if (!existing) throw new Error(`Rollout not found: ${id}`);

  const currentStatus = (existing.spec as any)?.status ?? "pending";
  const allowed = VALID_ROLLOUT_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.includes(status)) {
    throw new Error(
      `Invalid rollout transition: cannot go from '${currentStatus}' to '${status}'`,
    );
  }

  const specUpdates: Record<string, unknown> = { status };
  if (["succeeded", "failed", "rolled_back"].includes(status)) {
    specUpdates.completedAt = new Date().toISOString();
  }

  const [updated] = await db
    .update(rollout)
    .set({ spec: { ...(existing.spec as any), ...specUpdates } as any })
    .where(eq(rollout.id, id))
    .returning();

  return updated;
}

export async function listRollouts(
  db: Database,
  opts?: {
    releaseId?: string;
    systemDeploymentId?: string;
    deploymentTargetId?: string;
  },
) {
  const conditions = [];
  if (opts?.releaseId) conditions.push(eq(rollout.releaseId, opts.releaseId));
  const sdId = opts?.systemDeploymentId ?? opts?.deploymentTargetId;
  if (sdId) conditions.push(eq(rollout.systemDeploymentId, sdId));

  const base = db.select().from(rollout);
  const rows =
    conditions.length > 0
      ? await base.where(and(...conditions)).orderBy(desc(rollout.createdAt))
      : await base.orderBy(desc(rollout.createdAt));

  return { data: rows, total: rows.length };
}
