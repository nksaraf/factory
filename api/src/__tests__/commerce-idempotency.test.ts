import type { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"

import {
  type TestApp,
  createTestContext,
  truncateAllTables,
} from "../test-helpers"

const BASE = "http://localhost/api/v1/factory/commerce"

function post(
  url: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>
) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

describe("Commerce Idempotency", () => {
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

  beforeEach(async () => {
    await truncateAllTables(client)
  })

  it("request without idempotency key works normally", async () => {
    const res = await app.handle(
      post(`${BASE}/customers`, {
        slug: "no-key",
        name: "No Key Customer",
        spec: { type: "direct" },
      })
    )
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: Record<string, unknown> }
    expect(data.slug).toBe("no-key")
  })

  it("first request with idempotency key creates entity", async () => {
    const res = await app.handle(
      post(
        `${BASE}/customers`,
        {
          slug: "idem-create",
          name: "Idem Customer",
          spec: { type: "direct" },
        },
        { "Idempotency-Key": "key-001" }
      )
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Record<string, unknown> }
    expect(body.data.slug).toBe("idem-create")
  })

  it("retry with same key replays stored response (no duplicate)", async () => {
    const reqBody = {
      slug: "idem-retry",
      name: "Retry Customer",
      spec: { type: "direct" },
    }

    const first = await app.handle(
      post(`${BASE}/customers`, reqBody, { "Idempotency-Key": "key-retry" })
    )
    expect(first.status).toBe(200)
    const firstJson = (await first.json()) as {
      data: { id: string; slug: string }
    }

    const second = await app.handle(
      post(`${BASE}/customers`, reqBody, { "Idempotency-Key": "key-retry" })
    )
    expect(second.status).toBe(200)
    const secondJson = (await second.json()) as {
      data: { id: string; slug: string }
    }

    expect(firstJson.data.id).toBe(secondJson.data.id)

    const list = await app.handle(new Request(`${BASE}/customers`))
    const { data } = (await list.json()) as { data: unknown[] }
    expect(data).toHaveLength(1)
  })

  it("GET requests ignore idempotency key", async () => {
    await app.handle(
      post(`${BASE}/customers`, {
        slug: "get-test",
        name: "Get Test",
        spec: {},
      })
    )

    const res = await app.handle(
      new Request(`${BASE}/customers`, {
        headers: { "Idempotency-Key": "key-get" },
      })
    )
    expect(res.status).toBe(200)
  })

  it("different keys create separate entities", async () => {
    const body1 = {
      slug: "cust-a",
      name: "Customer A",
      spec: { type: "direct" },
    }
    const body2 = {
      slug: "cust-b",
      name: "Customer B",
      spec: { type: "direct" },
    }

    const r1 = await app.handle(
      post(`${BASE}/customers`, body1, { "Idempotency-Key": "key-a" })
    )
    expect(r1.status).toBe(200)

    const r2 = await app.handle(
      post(`${BASE}/customers`, body2, { "Idempotency-Key": "key-b" })
    )
    expect(r2.status).toBe(200)

    const list = await app.handle(new Request(`${BASE}/customers`))
    const { data } = (await list.json()) as { data: unknown[] }
    expect(data).toHaveLength(2)
  })

  it("actions respect idempotency keys", async () => {
    await app.handle(
      post(`${BASE}/customers`, {
        slug: "action-idem",
        name: "Action Idem",
        spec: { type: "direct", status: "trial" },
      })
    )

    const first = await app.handle(
      post(
        `${BASE}/customers/action-idem/activate`,
        {},
        { "Idempotency-Key": "key-activate" }
      )
    )
    expect(first.status).toBe(200)

    const second = await app.handle(
      post(
        `${BASE}/customers/action-idem/activate`,
        {},
        { "Idempotency-Key": "key-activate" }
      )
    )
    expect(second.status).toBe(200)
    const body = (await second.json()) as {
      data: { spec: { status: string } }
    }
    expect(body.data.spec.status).toBe("active")
  })

  it("error responses are cached (409 from guard)", async () => {
    await app.handle(
      post(`${BASE}/customers`, {
        slug: "err-cache",
        name: "Err Cache",
        spec: { type: "direct", status: "terminated" },
      })
    )

    const first = await app.handle(
      post(
        `${BASE}/customers/err-cache/activate`,
        {},
        { "Idempotency-Key": "key-err" }
      )
    )
    expect(first.status).toBe(409)

    const second = await app.handle(
      post(
        `${BASE}/customers/err-cache/activate`,
        {},
        { "Idempotency-Key": "key-err" }
      )
    )
    expect(second.status).toBe(409)
  })

  it("idempotency works for subscription creation", async () => {
    const custRes = await app.handle(
      post(`${BASE}/customers`, {
        slug: "sub-idem-cust",
        name: "Sub Idem",
        spec: { type: "direct", status: "active" },
      })
    )
    const { data: cust } = (await custRes.json()) as {
      data: { id: string }
    }

    const planRes = await app.handle(
      post(`${BASE}/plans`, {
        slug: "sub-idem-plan",
        name: "Sub Plan",
        type: "base",
        spec: { price: 999, billingInterval: "monthly", currency: "usd" },
      })
    )
    const { data: plan } = (await planRes.json()) as {
      data: { id: string }
    }

    const subBody = {
      customerId: cust.id,
      planId: plan.id,
      spec: {
        status: "trialing",
        currentPeriodStart: "2026-01-01T00:00:00Z",
        currentPeriodEnd: "2026-02-01T00:00:00Z",
      },
    }

    const first = await app.handle(
      post(`${BASE}/subscriptions`, subBody, {
        "Idempotency-Key": "key-sub-create",
      })
    )
    expect(first.status).toBe(200)

    const second = await app.handle(
      post(`${BASE}/subscriptions`, subBody, {
        "Idempotency-Key": "key-sub-create",
      })
    )
    expect(second.status).toBe(200)

    const list = await app.handle(new Request(`${BASE}/subscriptions`))
    const { data } = (await list.json()) as { data: unknown[] }
    expect(data).toHaveLength(1)
  })
})
