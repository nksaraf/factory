/**
 * Integration tests for chat handler DB helpers.
 * Uses PGlite (same pattern as workflow-helpers.test.ts).
 */
import { PGlite } from "@electric-sql/pglite"
import { and, eq } from "drizzle-orm"
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

import type { Database } from "../../db/connection"
import { channel, thread, threadTurn } from "../../db/schema/org-v2"
import { setChatDb } from "./db"

/** Test helper: create a mock ResolvedActor from a Slack user ID string. */
function mockActor(slackUserId: string) {
  return {
    principalId: null,
    principalName: null,
    principalEmail: null,
    externalId: slackUserId,
  }
}

// Mock the bot import so Chat SDK doesn't initialize during tests
vi.mock("./bot", () => ({
  bot: {
    onNewMention: vi.fn(),
    onSubscribedMessage: vi.fn(),
    onReaction: vi.fn(),
  },
}))

const { parseSlackThreadId, ensureChannel, ensureThread, recordTurn } =
  await import("./handlers")

// ── Test setup ──────────────────────────────────────────

let client: PGlite
let db: Database

beforeAll(async () => {
  client = new PGlite()
  db = drizzle(client) as unknown as Database

  await client.query(`CREATE SCHEMA IF NOT EXISTS org`)

  await client.query(`
    CREATE TABLE org.channel (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      external_id TEXT,
      name TEXT,
      repo_slug TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      spec JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      UNIQUE (kind, external_id)
    )
  `)

  await client.query(`
    CREATE TABLE org.thread (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      source TEXT NOT NULL,
      external_id TEXT,
      principal_id TEXT,
      agent_id TEXT,
      job_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      channel_id TEXT REFERENCES org.channel(id) ON DELETE SET NULL,
      repo_slug TEXT,
      branch TEXT,
      started_at TIMESTAMPTZ NOT NULL,
      ended_at TIMESTAMPTZ,
      parent_thread_id TEXT,
      spec JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      UNIQUE (source, external_id)
    )
  `)

  await client.query(`
    CREATE TABLE org.thread_turn (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES org.thread(id) ON DELETE CASCADE,
      turn_index INTEGER NOT NULL,
      role TEXT NOT NULL,
      spec JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      UNIQUE (thread_id, turn_index)
    )
  `)

  setChatDb(db)
})

afterAll(async () => {
  await client.close()
})

beforeEach(async () => {
  await client.query(`DELETE FROM org.thread_turn`)
  await client.query(`DELETE FROM org.thread`)
  await client.query(`DELETE FROM org.channel`)
})

// ── Tests ──────────────────────────────────────────────

describe("parseSlackThreadId", () => {
  it("parses slack:CHANNEL:TS format", () => {
    const result = parseSlackThreadId("slack:C12345:1234567890.123456")
    expect(result.slackChannelId).toBe("C12345")
    expect(result.slackThreadTs).toBe("1234567890.123456")
  })

  it("handles missing parts gracefully", () => {
    const result = parseSlackThreadId("slack")
    expect(result.slackChannelId).toBe("")
    expect(result.slackThreadTs).toBe("")
  })
})

describe("ensureChannel", () => {
  it("creates a new channel", async () => {
    const id = await ensureChannel("C12345")

    expect(id).toMatch(/^chan_/)

    const [row] = await db.select().from(channel).where(eq(channel.id, id))
    expect(row.kind).toBe("slack")
    expect(row.externalId).toBe("C12345")
    expect(row.status).toBe("active")
  })

  it("returns existing channel on second call", async () => {
    const id1 = await ensureChannel("C12345")
    const id2 = await ensureChannel("C12345")
    expect(id1).toBe(id2)
  })

  it("creates different channels for different Slack IDs", async () => {
    const id1 = await ensureChannel("C11111")
    const id2 = await ensureChannel("C22222")
    expect(id1).not.toBe(id2)
  })

  it("handles concurrent inserts without error", async () => {
    const results = await Promise.all([
      ensureChannel("CRACE"),
      ensureChannel("CRACE"),
      ensureChannel("CRACE"),
    ])

    // All should return the same channel ID
    expect(results[0]).toBe(results[1])
    expect(results[1]).toBe(results[2])

    // Only one row should exist
    const rows = await db
      .select()
      .from(channel)
      .where(and(eq(channel.kind, "slack"), eq(channel.externalId, "CRACE")))
    expect(rows).toHaveLength(1)
  })
})

describe("ensureThread", () => {
  let channelId: string

  beforeEach(async () => {
    channelId = await ensureChannel("CTEST")
  })

  it("creates a new thread", async () => {
    const id = await ensureThread(
      "slack:CTEST:1234.5678",
      channelId,
      mockActor("U_AUTHOR")
    )

    expect(id).toMatch(/^thrd_/)

    const [row] = await db.select().from(thread).where(eq(thread.id, id))
    expect(row.type).toBe("chat")
    expect(row.source).toBe("slack")
    expect(row.externalId).toBe("slack:CTEST:1234.5678")
    expect(row.channelId).toBe(channelId)
    expect(row.status).toBe("active")
    expect((row.spec as any).participants).toEqual(["U_AUTHOR"])
  })

  it("returns existing thread on second call", async () => {
    const id1 = await ensureThread(
      "slack:CTEST:1234.5678",
      channelId,
      mockActor("U1")
    )
    const id2 = await ensureThread(
      "slack:CTEST:1234.5678",
      channelId,
      mockActor("U2")
    )
    expect(id1).toBe(id2)
  })

  it("creates different threads for different external IDs", async () => {
    const id1 = await ensureThread(
      "slack:CTEST:1111.0000",
      channelId,
      mockActor("U1")
    )
    const id2 = await ensureThread(
      "slack:CTEST:2222.0000",
      channelId,
      mockActor("U1")
    )
    expect(id1).not.toBe(id2)
  })

  it("handles concurrent inserts without error", async () => {
    const threadKey = "slack:CTEST:RACE.0000"
    const results = await Promise.all([
      ensureThread(threadKey, channelId, mockActor("U1")),
      ensureThread(threadKey, channelId, mockActor("U2")),
      ensureThread(threadKey, channelId, mockActor("U3")),
    ])

    expect(results[0]).toBe(results[1])
    expect(results[1]).toBe(results[2])

    const rows = await db
      .select()
      .from(thread)
      .where(and(eq(thread.source, "slack"), eq(thread.externalId, threadKey)))
    expect(rows).toHaveLength(1)
  })
})

describe("recordTurn", () => {
  let threadId: string

  beforeEach(async () => {
    const channelId = await ensureChannel("CTURN")
    threadId = await ensureThread(
      "slack:CTURN:9999.0000",
      channelId,
      mockActor("U1")
    )
  })

  it("inserts a turn with turnIndex 0", async () => {
    await recordTurn(threadId, "user", "hello", "U_AUTHOR")

    const [row] = await db
      .select()
      .from(threadTurn)
      .where(eq(threadTurn.threadId, threadId))
    expect(row.turnIndex).toBe(0)
    expect(row.role).toBe("user")
    expect((row.spec as any).message).toBe("hello")
    expect((row.spec as any).prompt).toBe("slack:U_AUTHOR")
  })

  it("auto-increments turnIndex", async () => {
    await recordTurn(threadId, "user", "first", "U1")
    await recordTurn(threadId, "assistant", "second")
    await recordTurn(threadId, "user", "third", "U1")

    const rows = await db
      .select()
      .from(threadTurn)
      .where(eq(threadTurn.threadId, threadId))

    expect(rows).toHaveLength(3)
    const indices = rows.map((r) => r.turnIndex).sort()
    expect(indices).toEqual([0, 1, 2])
  })

  it("omits prompt field when no authorUserId", async () => {
    await recordTurn(threadId, "assistant", "bot reply")

    const [row] = await db
      .select()
      .from(threadTurn)
      .where(eq(threadTurn.threadId, threadId))
    expect((row.spec as any).prompt).toBeUndefined()
    expect((row.spec as any).message).toBe("bot reply")
  })

  it("stores timestamp in spec", async () => {
    await recordTurn(threadId, "user", "test")

    const [row] = await db
      .select()
      .from(threadTurn)
      .where(eq(threadTurn.threadId, threadId))
    expect((row.spec as any).timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it("handles concurrent turns with unique indices", async () => {
    // Fire 5 concurrent inserts — atomic subquery should assign unique indices.
    // Note: PGlite is single-connection, so these serialize in practice.
    // True multi-connection concurrency needs a retry-on-23505 wrapper.
    await Promise.all([
      recordTurn(threadId, "user", "msg-0", "U1"),
      recordTurn(threadId, "assistant", "msg-1"),
      recordTurn(threadId, "user", "msg-2", "U1"),
      recordTurn(threadId, "assistant", "msg-3"),
      recordTurn(threadId, "user", "msg-4", "U1"),
    ])

    const rows = await db
      .select()
      .from(threadTurn)
      .where(eq(threadTurn.threadId, threadId))

    expect(rows).toHaveLength(5)
    const indices = rows.map((r) => r.turnIndex).sort()
    expect(indices).toEqual([0, 1, 2, 3, 4])
  })

  it("maintains separate turn sequences per thread", async () => {
    const channelId = await ensureChannel("CTURN2")
    const threadId2 = await ensureThread(
      "slack:CTURN2:8888.0000",
      channelId,
      mockActor("U2")
    )

    await recordTurn(threadId, "user", "thread-1-msg")
    await recordTurn(threadId2, "user", "thread-2-msg")
    await recordTurn(threadId, "assistant", "thread-1-reply")

    const rows1 = await db
      .select()
      .from(threadTurn)
      .where(eq(threadTurn.threadId, threadId))
    const rows2 = await db
      .select()
      .from(threadTurn)
      .where(eq(threadTurn.threadId, threadId2))

    expect(rows1.map((r) => r.turnIndex).sort()).toEqual([0, 1])
    expect(rows2.map((r) => r.turnIndex).sort()).toEqual([0])
  })
})
