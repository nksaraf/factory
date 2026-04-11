/**
 * Workflow helpers — shared utilities for workflow implementations.
 */

import { eq, sql } from "drizzle-orm"

import type { Database } from "../db/connection"
import { workflowRun } from "../db/schema/org-v2"
import { logger } from "../logger"

// ── Workflow DB accessor ─────────────────────────────────
//
// DBOS serializes workflow inputs into the system database.
// Database connections are not serializable, so we use a module-level
// accessor instead of passing `db` through the workflow input.
//
// Call setWorkflowDb(db) before starting any workflow.
// Call getWorkflowDb() from within workflows and steps.

let _workflowDb: Database | null = null

/** Set the database connection for workflows. Called once at server boot. */
export function setWorkflowDb(db: Database) {
  _workflowDb = db
}

/** Get the database connection from within a workflow or step. */
export function getWorkflowDb(): Database {
  if (!_workflowDb) {
    throw new Error(
      "Workflow DB not initialized — call setWorkflowDb(db) at boot"
    )
  }
  return _workflowDb
}

// ── updateRun ─────────────────────────────────────────────

export interface WorkflowRunUpdate {
  phase: string
  status: string
  state: Record<string, unknown>
  output: unknown
  error: string
  completedAt: Date
}

/**
 * Update the workflow_run tracking row. Called by workflows to reflect
 * phase transitions and accumulate state for the REST API.
 *
 * The `state` field merges with existing state (shallow merge at top level).
 */
export async function updateRun(
  db: Database,
  runId: string,
  updates: Partial<WorkflowRunUpdate>
) {
  const setValues: Record<string, unknown> = { updatedAt: new Date() }

  if (updates.phase !== undefined) setValues.phase = updates.phase
  if (updates.status !== undefined) setValues.status = updates.status
  if (updates.output !== undefined) setValues.output = updates.output
  if (updates.error !== undefined) setValues.error = updates.error
  if (updates.completedAt !== undefined)
    setValues.completedAt = updates.completedAt

  // Merge state atomically using Postgres JSONB concatenation (||)
  if (updates.state !== undefined) {
    setValues.state = sql`COALESCE(${workflowRun.state}, '{}'::jsonb) || ${JSON.stringify(updates.state)}::jsonb`
  }

  await db
    .update(workflowRun)
    .set(setValues)
    .where(eq(workflowRun.workflowRunId, runId))

  // Log phase transitions and errors to stdout for observability
  if (updates.phase) {
    logger.info(
      { workflowRunId: runId, phase: updates.phase, status: updates.status },
      `workflow phase → ${updates.phase}`
    )
  }
  if (updates.error) {
    logger.error(
      { workflowRunId: runId, error: updates.error },
      "workflow failed"
    )
  }
}

// ── createWorkflowRun ─────────────────────────────────────

export interface CreateWorkflowRunInput {
  workflowRunId: string
  workflowName: string
  trigger: string
  input: unknown
  config?: Record<string, unknown>
  triggerPayload?: unknown
  parentWorkflowRunId?: string
}

/**
 * Insert a new workflow_run row. Called by triggers before starting
 * the DBOS workflow.
 */
export async function createWorkflowRun(
  db: Database,
  run: CreateWorkflowRunInput
) {
  const [row] = await db
    .insert(workflowRun)
    .values({
      workflowRunId: run.workflowRunId,
      workflowName: run.workflowName,
      trigger: run.trigger,
      input: run.input,
      config: run.config ?? {},
      triggerPayload: run.triggerPayload,
      parentWorkflowRunId: run.parentWorkflowRunId,
    })
    .returning()

  return row
}
