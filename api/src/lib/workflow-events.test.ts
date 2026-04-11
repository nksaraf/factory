/**
 * Tests for workflow event matching layer — emitEvent, cleanupExpiredSubscriptions.
 *
 * Note: waitForEvent requires DBOS runtime (recv/send), so it cannot be tested
 * without DBOS. These tests focus on emitEvent's JSONB containment matching
 * and subscription cleanup.
 */
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import type { Database } from "../db/connection"
import { eventSubscription } from "../db/schema/org-v2"
import { cleanupExpiredSubscriptions, emitEvent } from "./workflow-events"

// Mock send() from workflow-engine since we can't run DBOS in tests
const mockSend = vi.fn()
vi.mock("./workflow-engine", () => ({
  send: (...args: unknown[]) => mockSend(...args),
  recv: vi.fn(),
  getWorkflowId: () => "wfr_test",
}))

// ── Test setup ──────────────────────────────────────────

let client: PGlite
let db: Database

beforeAll(async () => {
  client = new PGlite()
  db = drizzle(client) as unknown as Database

  await client.query(`CREATE SCHEMA IF NOT EXISTS org`)
  await client.query(`
    CREATE TABLE org.event_subscription (
      id TEXT PRIMARY KEY,
      workflow_run_id TEXT NOT NULL,
      event_name TEXT NOT NULL,
      match_fields JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      expires_at TIMESTAMPTZ
    )
  `)
  // GIN index for containment queries
  await client.query(`
    CREATE INDEX esub_match_gin ON org.event_subscription
    USING gin (match_fields)
  `)
})

afterAll(async () => {
  await client.close()
})

beforeEach(async () => {
  await client.query(`DELETE FROM org.event_subscription`)
  mockSend.mockReset()
})

// Helper to insert a subscription
async function insertSub(opts: {
  id: string
  workflowRunId: string
  eventName: string
  matchFields: Record<string, string>
  expiresAt?: Date
}) {
  await db.insert(eventSubscription).values({
    id: opts.id,
    workflowRunId: opts.workflowRunId,
    eventName: opts.eventName,
    matchFields: opts.matchFields,
    expiresAt: opts.expiresAt ?? new Date(Date.now() + 600_000),
  })
}

// ── emitEvent ──────────────────────────────────────────

describe("emitEvent", () => {
  it("wakes a matching subscription via send()", async () => {
    await insertSub({
      id: "esub_1",
      workflowRunId: "wfr_abc",
      eventName: "workbench.ready",
      matchFields: { workbenchId: "wb-123" },
    })

    await emitEvent(db, "workbench.ready", {
      workbenchId: "wb-123",
      status: "active",
    })

    expect(mockSend).toHaveBeenCalledOnce()
    expect(mockSend).toHaveBeenCalledWith(
      "wfr_abc",
      { workbenchId: "wb-123", status: "active" },
      "workbench.ready"
    )
  })

  it("does not match subscriptions with different event names", async () => {
    await insertSub({
      id: "esub_2",
      workflowRunId: "wfr_abc",
      eventName: "pr.opened",
      matchFields: { repoFullName: "org/repo" },
    })

    await emitEvent(db, "workbench.ready", { workbenchId: "wb-123" })

    expect(mockSend).not.toHaveBeenCalled()
  })

  it("does not match when matchFields are not contained in event data", async () => {
    await insertSub({
      id: "esub_3",
      workflowRunId: "wfr_abc",
      eventName: "workbench.ready",
      matchFields: { workbenchId: "wb-999" },
    })

    // Emit with different workbenchId
    await emitEvent(db, "workbench.ready", {
      workbenchId: "wb-123",
      status: "active",
    })

    expect(mockSend).not.toHaveBeenCalled()
  })

  it("matches multiple subscriptions for the same event", async () => {
    await insertSub({
      id: "esub_4a",
      workflowRunId: "wfr_aaa",
      eventName: "pr.opened",
      matchFields: { repoFullName: "org/repo" },
    })
    await insertSub({
      id: "esub_4b",
      workflowRunId: "wfr_bbb",
      eventName: "pr.opened",
      matchFields: { repoFullName: "org/repo" },
    })

    await emitEvent(db, "pr.opened", {
      repoFullName: "org/repo",
      branchName: "feat/test",
      prNumber: "42",
    })

    expect(mockSend).toHaveBeenCalledTimes(2)
    const callWorkflowIds = mockSend.mock.calls.map((c: unknown[]) => c[0])
    expect(callWorkflowIds).toContain("wfr_aaa")
    expect(callWorkflowIds).toContain("wfr_bbb")
  })

  it("matches using JSONB containment — subset matching", async () => {
    // Subscription only cares about repoFullName and branchName
    await insertSub({
      id: "esub_5",
      workflowRunId: "wfr_subset",
      eventName: "pr.opened",
      matchFields: { repoFullName: "org/repo", branchName: "feat/x" },
    })

    // Event has more fields — should still match (containment)
    await emitEvent(db, "pr.opened", {
      repoFullName: "org/repo",
      branchName: "feat/x",
      prNumber: "99",
      prUrl: "https://github.com/org/repo/pull/99",
    })

    expect(mockSend).toHaveBeenCalledOnce()
  })

  it("skips expired subscriptions", async () => {
    await insertSub({
      id: "esub_expired",
      workflowRunId: "wfr_expired",
      eventName: "workbench.ready",
      matchFields: { workbenchId: "wb-123" },
      expiresAt: new Date(Date.now() - 60_000), // expired 1 minute ago
    })
    // Active sub for the same event
    await insertSub({
      id: "esub_active",
      workflowRunId: "wfr_active",
      eventName: "workbench.ready",
      matchFields: { workbenchId: "wb-123" },
    })

    await emitEvent(db, "workbench.ready", {
      workbenchId: "wb-123",
      status: "active",
    })

    expect(mockSend).toHaveBeenCalledOnce()
    expect(mockSend).toHaveBeenCalledWith(
      "wfr_active",
      { workbenchId: "wb-123", status: "active" },
      "workbench.ready"
    )
  })

  it("does not match when only partial matchFields are present", async () => {
    await insertSub({
      id: "esub_6",
      workflowRunId: "wfr_partial",
      eventName: "pr.comment",
      matchFields: { repoFullName: "org/repo", prNumber: "42" },
    })

    // Event only has repoFullName, missing prNumber
    await emitEvent(db, "pr.comment", {
      repoFullName: "org/repo",
      comment: "LGTM",
    })

    expect(mockSend).not.toHaveBeenCalled()
  })
})

// ── cleanupExpiredSubscriptions ────────────────────────

describe("cleanupExpiredSubscriptions", () => {
  it("removes expired subscriptions", async () => {
    // Insert one expired, one active
    await insertSub({
      id: "esub_exp",
      workflowRunId: "wfr_exp",
      eventName: "workbench.ready",
      matchFields: { workbenchId: "wb-old" },
      expiresAt: new Date(Date.now() - 60_000), // expired 1 minute ago
    })
    await insertSub({
      id: "esub_act",
      workflowRunId: "wfr_act",
      eventName: "workbench.ready",
      matchFields: { workbenchId: "wb-new" },
      expiresAt: new Date(Date.now() + 600_000), // expires in 10 minutes
    })

    await cleanupExpiredSubscriptions(db)

    const remaining = await db.select().from(eventSubscription)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe("esub_act")
  })

  it("does nothing when no subscriptions are expired", async () => {
    await insertSub({
      id: "esub_fresh",
      workflowRunId: "wfr_fresh",
      eventName: "pr.opened",
      matchFields: { repoFullName: "org/repo" },
      expiresAt: new Date(Date.now() + 3600_000),
    })

    await cleanupExpiredSubscriptions(db)

    const remaining = await db.select().from(eventSubscription)
    expect(remaining).toHaveLength(1)
  })
})
