import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createTestContext, truncateAllTables } from "../test-helpers"

describe("factory drizzle schemas", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    ctx = await createTestContext()
  })

  afterAll(async () => {
    await ctx.client.close()
  })

  it("exposes expected v2 schemas and core tables", async () => {
    const res = await ctx.client.query<{
      table_schema: string
      table_name: string
    }>(
      `SELECT table_schema, table_name
       FROM information_schema.tables
       WHERE table_schema IN ('org', 'infra', 'build', 'ops', 'commerce', 'software')
       ORDER BY table_schema, table_name`
    )
    const keys = res.rows.map((r) => `${r.table_schema}.${r.table_name}`)
    expect(keys).toContain("org.team")
    expect(keys).toContain("org.principal")
    expect(keys).toContain("org.thread")
    expect(keys).toContain("build.repo")
    expect(keys).toContain("infra.estate")
    expect(keys).toContain("infra.realm")
    expect(keys).toContain("ops.workspace")
    expect(keys).toContain("ops.site")
    expect(keys).toContain("commerce.customer")
    expect(keys).toContain("software.system")
    expect(keys).toContain("software.component")
  })

  it("truncateAllTables clears data", async () => {
    await truncateAllTables(ctx.client)
    // webhook_event is not re-seeded by seedTestParents, so it should be empty
    const res = await ctx.client.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM org.webhook_event`
    )
    expect(res.rows[0]?.c).toBe(0)
  })
})
