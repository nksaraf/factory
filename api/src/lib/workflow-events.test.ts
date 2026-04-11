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
  mock,
} from "bun:test"

import type { Database } from "../db/connection"
import { eventSubscription } from "../db/schema/org"
import { cleanupExpiredSubscriptions, emitEvent } from "./workflow-events"

const mockSend = mock()
const mockRecv = mock()

mock.module("./workflow-engine.js", () => ({
  send: (...args: unknown[]) => mockSend(...args),
  recv: mockRecv,
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
      name TEXT,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      topic_filter TEXT NOT NULL,
      match_fields JSONB,
      min_severity TEXT,
      scope_kind TEXT,
      scope_id TEXT,
      owner_kind TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      spec JSONB DEFAULT '{}' NOT NULL,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )
  `)
  // GIN index for containment queries (aligned with org schema)
  await client.query(`
    CREATE INDEX esub_match_gin ON org.event_subscription
    USING gin (COALESCE(match_fields, '{}'::jsonb))
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
  ownerId: string
  topicFilter: string
  matchFields: Record<string, string>
  expiresAt?: Date
}) {
  await db.insert(eventSubscription).values({
    id: opts.id,
    kind: "trigger",
    status: "active",
    topicFilter: opts.topicFilter,
    matchFields: opts.matchFields,
    ownerKind: "workflow",
    ownerId: opts.ownerId,
    expiresAt: opts.expiresAt ?? new Date(Date.now() + 600_000),
  })
}

// ── emitEvent ──────────────────────────────────────────

describe("emitEvent", () => {
  it("wakes a matching subscription via send()", async () => {
    await insertSub({
      id: "esub_1",
      ownerId: "wfr_abc",
      topicFilter: "workbench.ready",
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
      ownerId: "wfr_abc",
      topicFilter: "pr.opened",
      matchFields: { repoFullName: "org/repo" },
    })

    await emitEvent(db, "workbench.ready", { workbenchId: "wb-123" })

    expect(mockSend).not.toHaveBeenCalled()
  })

  it("does not match when matchFields are not contained in event data", async () => {
    await insertSub({
      id: "esub_3",
      ownerId: "wfr_abc",
      topicFilter: "workbench.ready",
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
      ownerId: "wfr_aaa",
      topicFilter: "pr.opened",
      matchFields: { repoFullName: "org/repo" },
    })
    await insertSub({
      id: "esub_4b",
      ownerId: "wfr_bbb",
      topicFilter: "pr.opened",
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
      ownerId: "wfr_subset",
      topicFilter: "pr.opened",
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
      ownerId: "wfr_expired",
      topicFilter: "workbench.ready",
      matchFields: { workbenchId: "wb-123" },
      expiresAt: new Date(Date.now() - 60_000), // expired 1 minute ago
    })
    // Active sub for the same event
    await insertSub({
      id: "esub_active",
      ownerId: "wfr_active",
      topicFilter: "workbench.ready",
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
      ownerId: "wfr_partial",
      topicFilter: "pr.comment",
      matchFields: { repoFullName: "org/repo", prNumber: "42" },
    })

    // Event only has repoFullName, missing prNumber
    await emitEvent(db, "pr.comment", {
      repoFullName: "org/repo",
      comment: "LGTM",
    })

    expect(mockSend).not.toHaveBeenCalled()
  })

  it("marks trigger subscription as fired after matching", async () => {
    await insertSub({
      id: "esub_fired",
      ownerId: "wfr_fired",
      topicFilter: "workbench.ready",
      matchFields: { workbenchId: "wb-123" },
    })

    await emitEvent(db, "workbench.ready", {
      workbenchId: "wb-123",
      status: "active",
    })

    const [sub] = await db
      .select()
      .from(eventSubscription)
      .where(eq(eventSubscription.id, "esub_fired"))

    expect(sub.status).toBe("fired")
  })
})

// ── cleanupExpiredSubscriptions ────────────────────────

describe("cleanupExpiredSubscriptions", () => {
  it("removes expired subscriptions", async () => {
    // Insert one expired, one active
    await insertSub({
      id: "esub_exp",
      ownerId: "wfr_exp",
      topicFilter: "workbench.ready",
      matchFields: { workbenchId: "wb-old" },
      expiresAt: new Date(Date.now() - 60_000), // expired 1 minute ago
    })
    await insertSub({
      id: "esub_act",
      ownerId: "wfr_act",
      topicFilter: "workbench.ready",
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
      ownerId: "wfr_fresh",
      topicFilter: "pr.opened",
      matchFields: { repoFullName: "org/repo" },
      expiresAt: new Date(Date.now() + 3600_000),
    })

    await cleanupExpiredSubscriptions(db)

    const remaining = await db.select().from(eventSubscription)
    expect(remaining).toHaveLength(1)
  })
})
