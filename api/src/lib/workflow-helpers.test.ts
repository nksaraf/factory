/**
 * Tests for workflow helpers — updateRun, createWorkflowRun, DB accessor.
 */
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"

import type { Database } from "../db/connection"
import { workflowRun } from "../db/schema/org"
import {
  createWorkflowRun,
  getWorkflowDb,
  setWorkflowDb,
  updateRun,
} from "./workflow-helpers"

// ── Test setup ──────────────────────────────────────────

let client: PGlite
let db: Database

beforeAll(async () => {
  client = new PGlite()
  db = drizzle(client) as unknown as Database

  // Create the org schema and workflow tables
  await client.query(`CREATE SCHEMA IF NOT EXISTS org`)
  await client.query(`
    CREATE TABLE org.workflow_run (
      workflow_run_id TEXT PRIMARY KEY,
      workflow_name TEXT NOT NULL,
      trigger TEXT NOT NULL,
      trigger_payload JSONB,
      input JSONB NOT NULL,
      output JSONB,
      state JSONB NOT NULL DEFAULT '{}',
      phase TEXT NOT NULL DEFAULT 'started',
      status TEXT NOT NULL DEFAULT 'running',
      error TEXT,
      parent_workflow_run_id TEXT,
      config JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      completed_at TIMESTAMPTZ
    )
  `)
})

afterAll(async () => {
  await client.close()
})

beforeEach(async () => {
  await client.query(`DELETE FROM org.workflow_run`)
})

// ── Tests ──────────────────────────────────────────────

describe("setWorkflowDb / getWorkflowDb", () => {
  it("throws when not initialized", () => {
    // Reset internal state by setting null via a workaround
    setWorkflowDb(null as unknown as Database)
    expect(() => getWorkflowDb()).toThrow("Workflow DB not initialized")
  })

  it("returns db after initialization", () => {
    setWorkflowDb(db)
    expect(getWorkflowDb()).toBe(db)
  })
})

describe("createWorkflowRun", () => {
  it("inserts a workflow run with defaults", async () => {
    setWorkflowDb(db)

    const row = await createWorkflowRun(db, {
      workflowRunId: "wfr_test1",
      workflowName: "god-workflow",
      trigger: "cli",
      input: { issueKey: "PROJ-1" },
    })

    expect(row.workflowRunId).toBe("wfr_test1")
    expect(row.workflowName).toBe("god-workflow")
    expect(row.status).toBe("running")
    expect(row.phase).toBe("started")
    expect(row.input).toEqual({ issueKey: "PROJ-1" })
    expect(row.state).toEqual({})
    expect(row.config).toEqual({})
  })

  it("accepts optional config and parentWorkflowRunId", async () => {
    const row = await createWorkflowRun(db, {
      workflowRunId: "wfr_child",
      workflowName: "code-review",
      trigger: "workflow",
      input: { prUrl: "https://github.com/org/repo/pull/1" },
      config: { timeout: 3600 },
      parentWorkflowRunId: "wfr_parent",
    })

    expect(row.config).toEqual({ timeout: 3600 })
    expect(row.parentWorkflowRunId).toBe("wfr_parent")
  })
})

describe("updateRun", () => {
  beforeEach(async () => {
    await createWorkflowRun(db, {
      workflowRunId: "wfr_upd",
      workflowName: "test-workflow",
      trigger: "cli",
      input: {},
    })
  })

  it("updates phase", async () => {
    await updateRun(db, "wfr_upd", { phase: "branch_creating" })

    const [row] = await db
      .select()
      .from(workflowRun)
      .where(eq(workflowRun.workflowRunId, "wfr_upd"))
    expect(row.phase).toBe("branch_creating")
  })

  it("updates status and completedAt", async () => {
    const now = new Date()
    await updateRun(db, "wfr_upd", {
      status: "succeeded",
      completedAt: now,
    })

    const [row] = await db
      .select()
      .from(workflowRun)
      .where(eq(workflowRun.workflowRunId, "wfr_upd"))
    expect(row.status).toBe("succeeded")
    expect(row.completedAt).toBeTruthy()
  })

  it("merges state atomically without overwriting", async () => {
    // First update: set branchName
    await updateRun(db, "wfr_upd", { state: { branchName: "feat/test" } })

    // Second update: set workbenchId (should NOT lose branchName)
    await updateRun(db, "wfr_upd", { state: { workbenchId: "wb-123" } })

    const [row] = await db
      .select()
      .from(workflowRun)
      .where(eq(workflowRun.workflowRunId, "wfr_upd"))

    const state = row.state as Record<string, unknown>
    expect(state.branchName).toBe("feat/test")
    expect(state.workbenchId).toBe("wb-123")
  })

  it("overwrites individual state fields on conflict", async () => {
    await updateRun(db, "wfr_upd", { state: { phase: "old" } })
    await updateRun(db, "wfr_upd", { state: { phase: "new" } })

    const [row] = await db
      .select()
      .from(workflowRun)
      .where(eq(workflowRun.workflowRunId, "wfr_upd"))

    expect((row.state as Record<string, unknown>).phase).toBe("new")
  })

  it("stores error on failure", async () => {
    await updateRun(db, "wfr_upd", {
      status: "failed",
      error: "Workbench timed out",
    })

    const [row] = await db
      .select()
      .from(workflowRun)
      .where(eq(workflowRun.workflowRunId, "wfr_upd"))
    expect(row.status).toBe("failed")
    expect(row.error).toBe("Workbench timed out")
  })

  it("stores output on completion", async () => {
    const output = {
      branchName: "feat/test",
      prUrl: "https://github.com/org/repo/pull/1",
    }
    await updateRun(db, "wfr_upd", { output })

    const [row] = await db
      .select()
      .from(workflowRun)
      .where(eq(workflowRun.workflowRunId, "wfr_upd"))
    expect(row.output).toEqual(output)
  })
})
