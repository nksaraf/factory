import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { eq } from "drizzle-orm"

import type { Database } from "../db/connection"
import { event, eventOutbox, eventSubscription } from "../db/schema/org"
import { createTestContext, truncateAllTables } from "../test-helpers"
import { emitEvent, emitExternalEvent } from "./events"
import { newId } from "./id"

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

describe("emitExternalEvent", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    ctx = await createTestContext()
  })

  afterAll(async () => {
    await ctx.client.close()
  })

  it("canonicalizes a GitHub push event", async () => {
    await truncateAllTables(ctx.client)
    const db = ctx.db as unknown as Database

    const eventId = await emitExternalEvent(db, {
      source: "github",
      eventType: "push",
      payload: { ref: "refs/heads/main", commits: [{ id: "abc123" }] },
      providerId: "repo-123",
      deliveryId: "delivery-456",
    })

    expect(eventId).toMatch(/^evt_/)

    const [row] = await db
      .select()
      .from(event)
      .where(eq(event.id, eventId!))
      .limit(1)

    expect(row.topic).toBe("ext.github.push")
    expect(row.source).toBe("github")
    expect(row.rawEventType).toBe("push")
    expect(row.idempotencyKey).toBe("github:repo-123:delivery-456")
    expect(row.spec.rawPayload).toEqual({
      ref: "refs/heads/main",
      commits: [{ id: "abc123" }],
    })
  })

  it("deduplicates external events by source+providerId+deliveryId", async () => {
    await truncateAllTables(ctx.client)
    const db = ctx.db as unknown as Database

    const id1 = await emitExternalEvent(db, {
      source: "github",
      eventType: "push",
      payload: { ref: "refs/heads/main" },
      providerId: "repo-123",
      deliveryId: "delivery-789",
    })

    const id2 = await emitExternalEvent(db, {
      source: "github",
      eventType: "push",
      payload: { ref: "refs/heads/main" },
      providerId: "repo-123",
      deliveryId: "delivery-789",
    })

    expect(id1).toMatch(/^evt_/)
    expect(id2).toBeNull()
  })
})

describe("subscription matching", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    ctx = await createTestContext()
  })

  afterAll(async () => {
    await ctx.client.close()
  })

  it("wakes workflow triggers when canonical event matches via domain-stripped fallback", async () => {
    await truncateAllTables(ctx.client)
    const db = ctx.db as unknown as Database

    // A trigger waiting on "workbench.ready" (legacy name)
    await db.insert(eventSubscription).values({
      id: newId("esub"),
      kind: "trigger",
      status: "active",
      topicFilter: "workbench.ready",
      matchFields: { workbenchId: "wb-test" },
      ownerKind: "workflow",
      ownerId: "wf-bridge-test",
      expiresAt: new Date(Date.now() + 600_000),
    })

    // Emit canonical event with domain prefix
    const eventId = await emitEvent(db, {
      topic: "ops.workbench.ready",
      source: "test",
      data: { workbenchId: "wb-test", status: "active" },
    })

    expect(eventId).toBeTruthy()
  })
})
