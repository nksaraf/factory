import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test"
import { eq } from "drizzle-orm"

import type { Database } from "../db/connection"
import { event, eventOutbox } from "../db/schema/org-v2"
import { createTestContext, truncateAllTables } from "../test-helpers"
import { emitEvent } from "./events"

const publishMock = mock(() => Promise.resolve(true))

// Mock NATS publish
mock.module("./nats", () => ({
  publishToNats: publishMock,
  getNatsConnection: mock(() => Promise.resolve(null)),
  closeNats: mock(),
}))

const { processOutbox } = await import("./outbox-relay")

describe("outbox relay", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    ctx = await createTestContext()
  })

  afterAll(async () => {
    await ctx.client.close()
  })

  it("publishes pending events and marks them as published", async () => {
    await truncateAllTables(ctx.client)
    const db = ctx.db as unknown as Database
    publishMock.mockResolvedValue(true)

    const eventId = await emitEvent(db, {
      topic: "ops.workbench.created",
      source: "test",
      data: { workbenchId: "wbnch-test-relay" },
    })

    const processed = await processOutbox(db)
    expect(processed).toBe(1)

    expect(publishMock).toHaveBeenCalledWith(
      "ops.workbench.created",
      expect.stringContaining('"topic":"ops.workbench.created"')
    )

    const [outboxRow] = await db
      .select()
      .from(eventOutbox)
      .where(eq(eventOutbox.eventId, eventId!))
      .limit(1)

    expect(outboxRow.status).toBe("published")
    expect(outboxRow.publishedAt).toBeDefined()
  })

  it("increments attempts and records error on publish failure", async () => {
    await truncateAllTables(ctx.client)
    const db = ctx.db as unknown as Database
    publishMock.mockResolvedValueOnce(false)

    const eventId = await emitEvent(db, {
      topic: "ops.workbench.failed",
      source: "test",
      data: { workbenchId: "wbnch-test-fail" },
    })

    const processed = await processOutbox(db)
    expect(processed).toBe(0)

    const [outboxRow] = await db
      .select()
      .from(eventOutbox)
      .where(eq(eventOutbox.eventId, eventId!))
      .limit(1)

    expect(outboxRow.status).toBe("pending")
    expect(outboxRow.attempts).toBe(1)
  })

  it("marks events as failed after max retries", async () => {
    await truncateAllTables(ctx.client)
    const db = ctx.db as unknown as Database
    publishMock.mockResolvedValue(false)

    const eventId = await emitEvent(db, {
      topic: "ops.workbench.failed",
      source: "test",
      data: {},
    })

    // Simulate 4 prior failed attempts
    await db
      .update(eventOutbox)
      .set({ attempts: 4 })
      .where(eq(eventOutbox.eventId, eventId!))

    await processOutbox(db)

    const [outboxRow] = await db
      .select()
      .from(eventOutbox)
      .where(eq(eventOutbox.eventId, eventId!))
      .limit(1)

    expect(outboxRow.status).toBe("failed")
    expect(outboxRow.attempts).toBe(5)
  })
})
