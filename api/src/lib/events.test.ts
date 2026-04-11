import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { Database } from "../db/connection"
import { event, eventOutbox } from "../db/schema/org-v2"
import { createTestContext, truncateAllTables } from "../test-helpers"
import { emitEvent } from "./events"

describe("emitEvent", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    ctx = await createTestContext()
  })

  afterAll(async () => {
    await ctx.client.close()
  })

  it("inserts into org.event and org.event_outbox", async () => {
    await truncateAllTables(ctx.client)
    const db = ctx.db as unknown as Database

    const eventId = await emitEvent(db, {
      topic: "ops.workbench.created",
      source: "test",
      severity: "info",
      entityKind: "workbench",
      entityId: "wbnch-test-1",
      data: { workbenchId: "wbnch-test-1", name: "test workbench" },
    })

    expect(eventId).toMatch(/^evt_/)

    // Verify event row
    const [eventRow] = await db
      .select()
      .from(event)
      .where(eq(event.id, eventId!))
      .limit(1)

    expect(eventRow).toBeDefined()
    expect(eventRow.topic).toBe("ops.workbench.created")
    expect(eventRow.source).toBe("test")
    expect(eventRow.severity).toBe("info")
    expect(eventRow.entityKind).toBe("workbench")
    expect(eventRow.entityId).toBe("wbnch-test-1")
    expect(eventRow.scopeKind).toBe("org")
    expect(eventRow.scopeId).toBe("default")
    expect(eventRow.spec).toEqual({
      data: { workbenchId: "wbnch-test-1", name: "test workbench" },
    })

    // Verify outbox row
    const [outboxRow] = await db
      .select()
      .from(eventOutbox)
      .where(eq(eventOutbox.eventId, eventId!))
      .limit(1)

    expect(outboxRow).toBeDefined()
    expect(outboxRow.status).toBe("pending")
    expect(outboxRow.attempts).toBe(0)
  })

  it("deduplicates by idempotencyKey", async () => {
    await truncateAllTables(ctx.client)
    const db = ctx.db as unknown as Database

    const id1 = await emitEvent(db, {
      topic: "ops.workbench.created",
      source: "test",
      data: { foo: "bar" },
      idempotencyKey: "test:dedup:1",
    })

    const id2 = await emitEvent(db, {
      topic: "ops.workbench.created",
      source: "test",
      data: { foo: "bar" },
      idempotencyKey: "test:dedup:1",
    })

    expect(id1).toMatch(/^evt_/)
    expect(id2).toBeNull()
  })

  it("stores rawEventType and rawPayload when provided", async () => {
    await truncateAllTables(ctx.client)
    const db = ctx.db as unknown as Database

    const eventId = await emitEvent(db, {
      topic: "org.agent.session_started",
      source: "claude-code",
      rawEventType: "session.start",
      rawPayload: { original: "payload" },
      data: { threadId: "thrd_123" },
    })

    const [row] = await db
      .select()
      .from(event)
      .where(eq(event.id, eventId!))
      .limit(1)

    expect(row.rawEventType).toBe("session.start")
    expect(row.spec).toEqual({
      data: { threadId: "thrd_123" },
      rawPayload: { original: "payload" },
    })
  })
})
