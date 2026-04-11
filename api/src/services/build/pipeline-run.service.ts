import type {
  PipelineRunSpec,
  PipelineStepSpec,
} from "@smp/factory-shared/schemas/build"
import { and, desc, eq, sql } from "drizzle-orm"

import type { Database } from "../../db/connection"
import { pipelineRun, pipelineStep } from "../../db/schema/build-v2"

// TODO: fix type — PipelineRunSpec schema does not yet include all fields stored here;
// these extra fields should be promoted to the shared schema or stored differently.
// startedAt/completedAt are stored as ISO strings (not Date objects) in JSONB.
type PipelineRunSpecStored = Omit<
  PipelineRunSpec,
  "startedAt" | "completedAt"
> & {
  triggerEvent?: string
  triggerRef?: string
  triggerActor?: string
  workflowFile?: string
  workspaceId?: string
  errorMessage?: string
  startedAt?: string
  completedAt?: string
}

// TODO: fix type — PipelineStepSpec schema does not yet include these fields.
// name/status are stored differently; startedAt/completedAt are ISO strings in JSONB.
type PipelineStepSpecStored = Omit<
  PipelineStepSpec,
  "name" | "status" | "startedAt" | "completedAt"
> & {
  name?: string
  jobName?: string
  stepName?: string
  status?: string
  exitCode?: number
  logUrl?: string
  startedAt?: string
  completedAt?: string
}

// TODO: fix type — Drizzle validates inserted values against PipelineRunSpec/$type<T>.
// Until the shared schema is updated to include the stored fields, we bridge via unknown.
function toPipelineRunSpec(stored: PipelineRunSpecStored): PipelineRunSpec {
  return stored as unknown as PipelineRunSpec
}

function toPipelineStepSpec(stored: PipelineStepSpecStored): PipelineStepSpec {
  return stored as unknown as PipelineStepSpec
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface CreatePipelineRunInput {
  repoId?: string
  triggerEvent: string
  triggerRef: string
  commitSha: string
  workflowFile?: string
  workspaceId?: string
  webhookEventId?: string
  triggerActor?: string
}

export interface UpdatePipelineRunInput {
  status?: string
  workspaceId?: string
  errorMessage?: string
  startedAt?: Date
  completedAt?: Date
}

export interface CreateStepInput {
  pipelineRunId: string
  jobName: string
  stepName?: string
}

export interface UpdateStepInput {
  status?: string
  exitCode?: number
  logUrl?: string
  startedAt?: Date
  completedAt?: Date
}

export interface ListPipelineRunsQuery {
  repoId?: string
  status?: string
  triggerEvent?: string
  triggerRef?: string
  limit?: number
  offset?: number
}

// ---------------------------------------------------------------------------
// Pipeline Run CRUD
// ---------------------------------------------------------------------------

export async function createPipelineRun(
  db: Database,
  input: CreatePipelineRunInput
) {
  // trigger field maps to the PipelineRunSpec enum; default to "push" if unknown
  const triggerValue =
    (["push", "pull_request", "manual", "schedule", "tag"] as const).find(
      (t) => t === input.triggerEvent
    ) ?? "push"
  const spec: PipelineRunSpecStored = {
    trigger: triggerValue,
    triggerEvent: input.triggerEvent,
    triggerRef: input.triggerRef,
    triggerActor: input.triggerActor,
    workflowFile: input.workflowFile,
    workspaceId: input.workspaceId,
  }

  const [row] = await db
    .insert(pipelineRun)
    .values({
      repoId: input.repoId ?? "unknown",
      commitSha: input.commitSha,
      webhookEventId: input.webhookEventId,
      status: "pending",
      spec: toPipelineRunSpec(spec),
    })
    .returning()
  return row
}

export async function getPipelineRun(db: Database, id: string) {
  const [row] = await db
    .select()
    .from(pipelineRun)
    .where(eq(pipelineRun.id, id))
    .limit(1)
  return row ?? null
}

export async function listPipelineRuns(
  db: Database,
  query: ListPipelineRunsQuery = {}
) {
  const conditions = []
  if (query.repoId) conditions.push(eq(pipelineRun.repoId, query.repoId))
  if (query.status) conditions.push(eq(pipelineRun.status, query.status))
  // triggerEvent, triggerRef are in spec JSONB — filter post-query

  let rows = await db
    .select()
    .from(pipelineRun)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(pipelineRun.createdAt))
    .limit(query.limit ?? 50)
    .offset(query.offset ?? 0)

  if (query.triggerEvent) {
    rows = rows.filter(
      (r) =>
        (r.spec as PipelineRunSpecStored)?.triggerEvent === query.triggerEvent
    )
  }
  if (query.triggerRef) {
    rows = rows.filter(
      (r) => (r.spec as PipelineRunSpecStored)?.triggerRef === query.triggerRef
    )
  }

  return rows
}

export async function updatePipelineRun(
  db: Database,
  id: string,
  input: UpdatePipelineRunInput
) {
  const existing = await getPipelineRun(db, id)
  if (!existing) return null

  // merge updates into spec JSONB for non-column fields
  const newSpec: PipelineRunSpecStored = {
    ...(existing.spec as PipelineRunSpecStored),
    ...(input.workspaceId !== undefined
      ? { workspaceId: input.workspaceId }
      : {}),
    ...(input.errorMessage !== undefined
      ? { errorMessage: input.errorMessage }
      : {}),
    ...(input.startedAt !== undefined
      ? { startedAt: input.startedAt.toISOString() }
      : {}),
    ...(input.completedAt !== undefined
      ? { completedAt: input.completedAt.toISOString() }
      : {}),
  }

  const [row] = await db
    .update(pipelineRun)
    .set({
      status: input.status ?? existing.status,
      spec: toPipelineRunSpec(newSpec),
      updatedAt: new Date(),
    })
    .where(eq(pipelineRun.id, id))
    .returning()
  return row ?? null
}

export async function cancelPipelineRun(db: Database, id: string) {
  const existing = await getPipelineRun(db, id)
  if (!existing) return null

  const newSpec: PipelineRunSpecStored = {
    ...(existing.spec as PipelineRunSpecStored),
    completedAt: new Date().toISOString(),
  }

  const [row] = await db
    .update(pipelineRun)
    .set({
      status: "cancelled",
      spec: toPipelineRunSpec(newSpec),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(pipelineRun.id, id),
        sql`${pipelineRun.status} IN ('pending', 'queued', 'running')`
      )
    )
    .returning()
  return row ?? null
}

// ---------------------------------------------------------------------------
// Pipeline Step CRUD
// ---------------------------------------------------------------------------

export async function createStepRun(db: Database, input: CreateStepInput) {
  // jobName, stepName stored in spec JSONB
  const [row] = await db
    .insert(pipelineStep)
    .values({
      pipelineRunId: input.pipelineRunId,
      spec: toPipelineStepSpec({
        jobName: input.jobName,
        stepName: input.stepName,
      }),
    })
    .returning()
  return row
}

export async function listStepRuns(db: Database, pipelineRunId: string) {
  return db
    .select()
    .from(pipelineStep)
    .where(eq(pipelineStep.pipelineRunId, pipelineRunId))
    .orderBy(pipelineStep.createdAt)
}

export async function updateStepRun(
  db: Database,
  stepId: string,
  input: UpdateStepInput
) {
  const [existing] = await db
    .select()
    .from(pipelineStep)
    .where(eq(pipelineStep.id, stepId))
    .limit(1)
  if (!existing) return null

  const newSpec: PipelineStepSpecStored = {
    ...(existing.spec as PipelineStepSpecStored),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
    ...(input.logUrl !== undefined ? { logUrl: input.logUrl } : {}),
    ...(input.startedAt !== undefined
      ? { startedAt: input.startedAt.toISOString() }
      : {}),
    ...(input.completedAt !== undefined
      ? { completedAt: input.completedAt.toISOString() }
      : {}),
  }

  const [row] = await db
    .update(pipelineStep)
    .set({ spec: toPipelineStepSpec(newSpec) })
    .where(eq(pipelineStep.id, stepId))
    .returning()
  return row ?? null
}

// ---------------------------------------------------------------------------
// Get run with steps (joined)
// ---------------------------------------------------------------------------

export async function getPipelineRunWithSteps(db: Database, id: string) {
  const run = await getPipelineRun(db, id)
  if (!run) return null
  const steps = await listStepRuns(db, id)
  return { ...run, steps }
}
