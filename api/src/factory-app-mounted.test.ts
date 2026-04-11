import { afterAll, beforeAll, describe, expect, it } from "bun:test"

import { createTestContext, type TestApp } from "./test-helpers"
import type { PGlite } from "@electric-sql/pglite"

describe("FactoryAPI mounted app", () => {
  let app: TestApp
  let client: PGlite

  beforeAll(async () => {
    const ctx = await createTestContext()
    app = ctx.app
    client = ctx.client
  })

  afterAll(async () => {
    await client.close()
  })

  it("GET /health returns ok", async () => {
    const res = await app.handle(new Request("http://localhost/health"))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; service: string }
    expect(body.status).toBe("ok")
    expect(body.service).toBe("factory-api")
  })
})
