/**
 * Tests for workflow event matching layer — emitEvent, cleanupExpiredSubscriptions.
 *
 * Note: waitForEvent requires the Workflow SDK runtime (createWebhook/sleep),
 * so it cannot be tested in isolation. These tests focus on emitEvent's JSONB
 * containment matching and subscription cleanup.
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

// Mock global fetch — emitEvent POSTs to webhook URLs
const mockFetch = mock(() => Promise.resolve(new Response("ok")))
globalThis.fetch = mockFetch as unknown as typeof fetch

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
  mockFetch.mockReset()
  mockFetch.mockImplementation(() => Promise.resolve(new Response("ok")))
})

// Helper to insert a subscription (ownerKind: "webhook", ownerId: webhook URL)
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
    ownerKind: "webhook",
    ownerId: opts.ownerId,
    expiresAt: opts.expiresAt ?? new Date(Date.now() + 600_000),
  })
}

// ── emitEvent ──────────────────────────────────────────

describe("emitEvent", () => {
  it("POSTs to a matching subscription's webhook URL", async () => {
    await insertSub({
      id: "esub_1",
      ownerId: "https://workflow.test/webhook/abc",
      topicFilter: "workbench.ready",
      matchFields: { workbenchId: "wb-123" },
    })

    await emitEvent(db, "workbench.ready", {
      workbenchId: "wb-123",
      status: "active",
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, opts] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe("https://workflow.test/webhook/abc")
    expect(JSON.parse(opts.body as string)).toEqual({
      workbenchId: "wb-123",
      status: "active",
    })
  })

  it("does not match subscriptions with different event names", async () => {
    await insertSub({
      id: "esub_2",
      ownerId: "https://workflow.test/webhook/xyz",
      topicFilter: "pr.opened",
      matchFields: { repoFullName: "org/repo" },
    })

    await emitEvent(db, "workbench.ready", { workbenchId: "wb-123" })

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("does not match when matchFields are not contained in event data", async () => {
    await insertSub({
      id: "esub_3",
      ownerId: "https://workflow.test/webhook/xyz",
      topicFilter: "workbench.ready",
      matchFields: { workbenchId: "wb-999" },
    })

    await emitEvent(db, "workbench.ready", {
      workbenchId: "wb-123",
      status: "active",
    })

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("matches multiple subscriptions for the same event", async () => {
    await insertSub({
      id: "esub_4a",
      ownerId: "https://workflow.test/webhook/aaa",
      topicFilter: "pr.opened",
      matchFields: { repoFullName: "org/repo" },
    })
    await insertSub({
      id: "esub_4b",
      ownerId: "https://workflow.test/webhook/bbb",
      topicFilter: "pr.opened",
      matchFields: { repoFullName: "org/repo" },
    })

    await emitEvent(db, "pr.opened", {
      repoFullName: "org/repo",
      branchName: "feat/test",
      prNumber: "42",
    })

    expect(mockFetch).toHaveBeenCalledTimes(2)
    const calledUrls = mockFetch.mock.calls.map((c: unknown[]) => c[0])
    expect(calledUrls).toContain("https://workflow.test/webhook/aaa")
    expect(calledUrls).toContain("https://workflow.test/webhook/bbb")
  })

  it("matches using JSONB containment — subset matching", async () => {
    await insertSub({
      id: "esub_5",
      ownerId: "https://workflow.test/webhook/subset",
      topicFilter: "pr.opened",
      matchFields: { repoFullName: "org/repo", branchName: "feat/x" },
    })

    await emitEvent(db, "pr.opened", {
      repoFullName: "org/repo",
      branchName: "feat/x",
      prNumber: "99",
      prUrl: "https://github.com/org/repo/pull/99",
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("skips expired subscriptions", async () => {
    await insertSub({
      id: "esub_expired",
      ownerId: "https://workflow.test/webhook/expired",
      topicFilter: "workbench.ready",
      matchFields: { workbenchId: "wb-123" },
      expiresAt: new Date(Date.now() - 60_000),
    })
    await insertSub({
      id: "esub_active",
      ownerId: "https://workflow.test/webhook/active",
      topicFilter: "workbench.ready",
      matchFields: { workbenchId: "wb-123" },
    })

    await emitEvent(db, "workbench.ready", {
      workbenchId: "wb-123",
      status: "active",
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url] = mockFetch.mock.calls[0] as unknown as [string]
    expect(url).toBe("https://workflow.test/webhook/active")
  })

  it("does not match when only partial matchFields are present", async () => {
    await insertSub({
      id: "esub_6",
      ownerId: "https://workflow.test/webhook/partial",
      topicFilter: "pr.comment",
      matchFields: { repoFullName: "org/repo", prNumber: "42" },
    })

    await emitEvent(db, "pr.comment", {
      repoFullName: "org/repo",
      comment: "LGTM",
    })

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("marks trigger subscription as fired after matching", async () => {
    await insertSub({
      id: "esub_fired",
      ownerId: "https://workflow.test/webhook/fired",
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
    await insertSub({
      id: "esub_exp",
      ownerId: "https://workflow.test/webhook/exp",
      topicFilter: "workbench.ready",
      matchFields: { workbenchId: "wb-old" },
      expiresAt: new Date(Date.now() - 60_000),
    })
    await insertSub({
      id: "esub_act",
      ownerId: "https://workflow.test/webhook/act",
      topicFilter: "workbench.ready",
      matchFields: { workbenchId: "wb-new" },
      expiresAt: new Date(Date.now() + 600_000),
    })

    await cleanupExpiredSubscriptions(db)

    const remaining = await db.select().from(eventSubscription)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe("esub_act")
  })

  it("does nothing when no subscriptions are expired", async () => {
    await insertSub({
      id: "esub_fresh",
      ownerId: "https://workflow.test/webhook/fresh",
      topicFilter: "pr.opened",
      matchFields: { repoFullName: "org/repo" },
      expiresAt: new Date(Date.now() + 3600_000),
    })

    await cleanupExpiredSubscriptions(db)

    const remaining = await db.select().from(eventSubscription)
    expect(remaining).toHaveLength(1)
  })
})
