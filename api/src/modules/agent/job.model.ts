import { eq, and, desc } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { job } from "../../db/schema/agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CreateJobInput = {
  agentId: string;
  mode: string;
  trigger: string;
  task: string;
  entityKind?: string;
  entityId?: string;
  channelKind?: string;
  channelId?: string;
  messageThreadId?: string;
  parentJobId?: string;
  delegatedByAgentId?: string;
  metadata?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createJob(db: Database, data: CreateJobInput) {
  const rows = await db
    .insert(job)
    .values({
      agentId: data.agentId,
      mode: data.mode,
      trigger: data.trigger,
      task: data.task,
      entityKind: data.entityKind ?? null,
      entityId: data.entityId ?? null,
      channelKind: data.channelKind ?? null,
      channelId: data.channelId ?? null,
      messageThreadId: data.messageThreadId ?? null,
      parentJobId: data.parentJobId ?? null,
      delegatedByAgentId: data.delegatedByAgentId ?? null,
      metadata: data.metadata ?? {},
    })
    .returning();
  return rows[0];
}

export async function getJob(db: Database, jobId: string) {
  const rows = await db
    .select()
    .from(job)
    .where(eq(job.jobId, jobId))
    .limit(1);
  return rows[0] ?? null;
}

export async function listJobs(
  db: Database,
  filters?: {
    agentId?: string;
    status?: string;
    mode?: string;
    trigger?: string;
    entityKind?: string;
    entityId?: string;
    parentJobId?: string;
    limit?: number;
    offset?: number;
  },
) {
  const limit = Math.min(filters?.limit ?? 50, 200);
  const offset = filters?.offset ?? 0;

  let query = db.select().from(job);

  if (filters?.agentId) {
    query = query.where(eq(job.agentId, filters.agentId)) as typeof query;
  }
  if (filters?.status) {
    query = query.where(eq(job.status, filters.status)) as typeof query;
  }
  if (filters?.mode) {
    query = query.where(eq(job.mode, filters.mode)) as typeof query;
  }
  if (filters?.trigger) {
    query = query.where(eq(job.trigger, filters.trigger)) as typeof query;
  }
  if (filters?.entityKind && filters?.entityId) {
    query = query.where(
      and(eq(job.entityKind, filters.entityKind), eq(job.entityId, filters.entityId)),
    ) as typeof query;
  }
  if (filters?.parentJobId) {
    query = query.where(eq(job.parentJobId, filters.parentJobId)) as typeof query;
  }

  const rows = await query
    .orderBy(desc(job.startedAt))
    .limit(limit)
    .offset(offset);
  return { data: rows, total: rows.length };
}

// ---------------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------------

export async function startJob(db: Database, jobId: string) {
  const rows = await db
    .update(job)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(job.jobId, jobId))
    .returning();
  return rows[0] ?? null;
}

export async function completeJob(
  db: Database,
  jobId: string,
  outcome?: Record<string, unknown>,
  costCents?: number,
) {
  const rows = await db
    .update(job)
    .set({
      status: "succeeded",
      outcome: outcome ?? null,
      costCents: costCents ?? null,
      completedAt: new Date(),
    })
    .where(eq(job.jobId, jobId))
    .returning();
  return rows[0] ?? null;
}

export async function failJob(
  db: Database,
  jobId: string,
  outcome?: Record<string, unknown>,
) {
  const rows = await db
    .update(job)
    .set({
      status: "failed",
      outcome: outcome ?? null,
      completedAt: new Date(),
    })
    .where(eq(job.jobId, jobId))
    .returning();
  return rows[0] ?? null;
}

export async function cancelJob(db: Database, jobId: string) {
  const rows = await db
    .update(job)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(eq(job.jobId, jobId))
    .returning();
  return rows[0] ?? null;
}

export async function overrideJob(
  db: Database,
  jobId: string,
  note: string,
) {
  const rows = await db
    .update(job)
    .set({ humanOverride: true, overrideNote: note })
    .where(eq(job.jobId, jobId))
    .returning();
  return rows[0] ?? null;
}
