import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { pipelineRun, pipelineStepRun } from "../../db/schema/build";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface CreatePipelineRunInput {
  repoId?: string;
  triggerEvent: string;
  triggerRef: string;
  commitSha: string;
  workflowFile?: string;
  sandboxId?: string;
  webhookEventId?: string;
  triggerActor?: string;
}

export interface UpdatePipelineRunInput {
  status?: string;
  sandboxId?: string;
  errorMessage?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface CreateStepRunInput {
  pipelineRunId: string;
  jobName: string;
  stepName?: string;
}

export interface UpdateStepRunInput {
  status?: string;
  exitCode?: number;
  logUrl?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface ListPipelineRunsQuery {
  repoId?: string;
  status?: string;
  triggerEvent?: string;
  triggerRef?: string;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Pipeline Run CRUD
// ---------------------------------------------------------------------------

export async function createPipelineRun(db: Database, input: CreatePipelineRunInput) {
  const [row] = await db
    .insert(pipelineRun)
    .values(input)
    .returning();
  return row;
}

export async function getPipelineRun(db: Database, id: string) {
  const [row] = await db
    .select()
    .from(pipelineRun)
    .where(eq(pipelineRun.pipelineRunId, id))
    .limit(1);
  return row ?? null;
}

export async function listPipelineRuns(db: Database, query: ListPipelineRunsQuery = {}) {
  const conditions = [];
  if (query.repoId) conditions.push(eq(pipelineRun.repoId, query.repoId));
  if (query.status) conditions.push(eq(pipelineRun.status, query.status));
  if (query.triggerEvent) conditions.push(eq(pipelineRun.triggerEvent, query.triggerEvent));
  if (query.triggerRef) conditions.push(eq(pipelineRun.triggerRef, query.triggerRef));

  const rows = await db
    .select()
    .from(pipelineRun)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(pipelineRun.createdAt))
    .limit(query.limit ?? 50)
    .offset(query.offset ?? 0);

  return rows;
}

export async function updatePipelineRun(db: Database, id: string, input: UpdatePipelineRunInput) {
  const [row] = await db
    .update(pipelineRun)
    .set(input)
    .where(eq(pipelineRun.pipelineRunId, id))
    .returning();
  return row ?? null;
}

export async function cancelPipelineRun(db: Database, id: string) {
  const [row] = await db
    .update(pipelineRun)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(
      and(
        eq(pipelineRun.pipelineRunId, id),
        sql`${pipelineRun.status} IN ('pending', 'queued', 'running')`,
      ),
    )
    .returning();
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Pipeline Step Run CRUD
// ---------------------------------------------------------------------------

export async function createStepRun(db: Database, input: CreateStepRunInput) {
  const [row] = await db
    .insert(pipelineStepRun)
    .values(input)
    .returning();
  return row;
}

export async function listStepRuns(db: Database, pipelineRunId: string) {
  return db
    .select()
    .from(pipelineStepRun)
    .where(eq(pipelineStepRun.pipelineRunId, pipelineRunId))
    .orderBy(pipelineStepRun.createdAt);
}

export async function updateStepRun(db: Database, stepId: string, input: UpdateStepRunInput) {
  const [row] = await db
    .update(pipelineStepRun)
    .set(input)
    .where(eq(pipelineStepRun.pipelineStepRunId, stepId))
    .returning();
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Get run with steps (joined)
// ---------------------------------------------------------------------------

export async function getPipelineRunWithSteps(db: Database, id: string) {
  const run = await getPipelineRun(db, id);
  if (!run) return null;
  const steps = await listStepRuns(db, id);
  return { ...run, steps };
}
