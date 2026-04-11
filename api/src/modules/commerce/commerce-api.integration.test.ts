import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createTestContext, truncateAllTables } from "../../test-helpers"

describe("commerce plane API", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    ctx = await createTestContext()
  })

  afterAll(async () => {
    await ctx.client.close()
  })

  it("creates a customer with cust_ ID prefix and trial status in spec", async () => {
    await truncateAllTables(ctx.client)
    const res = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/commerce/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: "acme-corp",
          name: "Acme Corp",
          spec: { status: "trial" },
        }),
      })
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      data: { id: string; name: string; slug: string; spec: { status: string } }
    }
    expect(json.data.id).toMatch(/^cust_/)
    expect(json.data.name).toBe("Acme Corp")
    expect(json.data.slug).toBe("acme-corp")
    expect(json.data.spec.status).toBe("trial")
  })

  it("lists and gets customers", async () => {
    await truncateAllTables(ctx.client)

    // Create two customers
    const res1 = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/commerce/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: "alpha-inc",
          name: "Alpha Inc",
          spec: {},
        }),
      })
    )
    const cust1 = (await res1.json()) as {
      data: { id: string; name: string }
    }

    await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/commerce/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "beta-llc", name: "Beta LLC", spec: {} }),
      })
    )

    // List
    const listRes = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/commerce/customers")
    )
    expect(listRes.status).toBe(200)
    const listJson = (await listRes.json()) as {
      data: { name: string }[]
      meta: { total: number }
    }
    expect(listJson.data.length).toBe(2)
    expect(listJson.meta.total).toBe(2)

    // Get by ID
    const getRes = await ctx.app.handle(
      new Request(
        `http://localhost/api/v1/factory/commerce/customers/${cust1.data.id}`
      )
    )
    expect(getRes.status).toBe(200)
    const getJson = (await getRes.json()) as {
      data: { id: string; name: string }
    }
    expect(getJson.data.name).toBe("Alpha Inc")
  })

  it("returns 404 for unknown customer", async () => {
    await truncateAllTables(ctx.client)
    const res = await ctx.app.handle(
      new Request(
        "http://localhost/api/v1/factory/commerce/customers/cust_nonexistent"
      )
    )
    expect(res.status).toBe(404)
    const json = (await res.json()) as { error: { code: string } }
    expect(json.error.code).toBe("not_found")
  })

  it("updates customer status in spec from trial to active", async () => {
    await truncateAllTables(ctx.client)
    const createRes = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/commerce/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: "gamma-co",
          name: "Gamma Co",
          spec: { status: "trial" },
        }),
      })
    )
    const created = (await createRes.json()) as {
      data: { id: string; spec: { status: string } }
    }
    expect(created.data.spec.status).toBe("trial")

    const patchRes = await ctx.app.handle(
      new Request(
        `http://localhost/api/v1/factory/commerce/customers/${created.data.id}/update`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spec: { status: "active" } }),
        }
      )
    )
    expect(patchRes.status).toBe(200)
    const patched = (await patchRes.json()) as {
      data: { id: string; spec: { status: string } }
    }
    expect(patched.data.spec.status).toBe("active")
  })

  it("creates and lists plans", async () => {
    await truncateAllTables(ctx.client)
    const createRes = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/commerce/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: "starter-plan",
          name: "Starter Plan",
          type: "base",
          spec: {
            price: 0,
            billingInterval: "monthly",
            currency: "usd",
            includedCapabilities: ["billing", "analytics"],
            trialDays: 14,
            isPublic: true,
          },
        }),
      })
    )
    expect(createRes.status).toBe(200)
    const created = (await createRes.json()) as {
      data: {
        id: string
        name: string
        slug: string
        type: string
        spec: { includedCapabilities: string[] }
      }
    }
    expect(created.data.id).toMatch(/^pln_/)
    expect(created.data.name).toBe("Starter Plan")
    expect(created.data.slug).toBe("starter-plan")
    expect(created.data.type).toBe("base")
    expect(created.data.spec.includedCapabilities).toEqual([
      "billing",
      "analytics",
    ])

    const listRes = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/commerce/plans")
    )
    expect(listRes.status).toBe(200)
    const listed = (await listRes.json()) as {
      data: { id: string; name: string }[]
      meta: { total: number }
    }
    expect(listed.data.length).toBe(1)
    expect(listed.data[0]!.name).toBe("Starter Plan")
  })

  it("soft-deletes a customer via bitemporal delete", async () => {
    await truncateAllTables(ctx.client)
    const createRes = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/commerce/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: "to-delete",
          name: "To Delete",
          spec: {},
        }),
      })
    )
    const created = (await createRes.json()) as { data: { id: string } }
    expect(createRes.status).toBe(200)

    const deleteRes = await ctx.app.handle(
      new Request(
        `http://localhost/api/v1/factory/commerce/customers/${created.data.id}/delete`,
        { method: "POST" }
      )
    )
    expect(deleteRes.status).toBe(200)
    const deleted = (await deleteRes.json()) as { data: { deleted: boolean } }
    expect(deleted.data.deleted).toBe(true)

    // After bitemporal delete, the customer should no longer appear in the list
    const listRes = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/commerce/customers")
    )
    const list = (await listRes.json()) as {
      data: unknown[]
      meta: { total: number }
    }
    expect(list.meta.total).toBe(0)
  })
})
