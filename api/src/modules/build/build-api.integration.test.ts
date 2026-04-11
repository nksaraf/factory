import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createTestContext, truncateAllTables } from "../../test-helpers"

describe("build plane API", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    ctx = await createTestContext()
  })

  afterAll(async () => {
    await ctx.client.close()
  })

  it("creates and lists repos", async () => {
    await truncateAllTables(ctx.client)
    const res = await ctx.app.handle(
      new Request("http://localhost/api/factory/build/repos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: "billing-git",
          name: "billing-git",
          spec: {
            url: "https://example.com/billing.git",
            defaultBranch: "main",
            kind: "product-module",
          },
        }),
      })
    )
    expect(res.status).toBe(200)
    const created = (await res.json()) as {
      data: { id: string; name: string; slug: string }
    }
    expect(created.data.name).toBe("billing-git")
    expect(created.data.slug).toBe("billing-git")

    const list = await ctx.app.handle(
      new Request("http://localhost/api/factory/build/repos")
    )
    expect(list.status).toBe(200)
    const body = (await list.json()) as {
      data: { name: string }[]
      meta: { total: number }
    }
    expect(body.data.some((r) => r.name === "billing-git")).toBe(true)
    expect(body.meta.total).toBeGreaterThan(0)

    const one = await ctx.app.handle(
      new Request(`http://localhost/api/factory/build/repos/${created.data.id}`)
    )
    expect(one.status).toBe(200)
  })

  it("returns 404 for unknown repo", async () => {
    await truncateAllTables(ctx.client)
    const res = await ctx.app.handle(
      new Request("http://localhost/api/factory/build/repos/repo_nonexistent")
    )
    expect(res.status).toBe(404)
    const json = (await res.json()) as { error: { code: string } }
    expect(json.error.code).toBe("not_found")
  })

  it("updates a repo slug and name", async () => {
    await truncateAllTables(ctx.client)
    const createRes = await ctx.app.handle(
      new Request("http://localhost/api/factory/build/repos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: "my-repo",
          name: "my-repo",
          spec: {
            url: "https://example.com/my-repo.git",
            defaultBranch: "main",
            kind: "library",
          },
        }),
      })
    )
    const created = (await createRes.json()) as {
      data: { id: string; slug: string; name: string }
    }
    expect(createRes.status).toBe(200)

    const patchRes = await ctx.app.handle(
      new Request(
        `http://localhost/api/factory/build/repos/${created.data.id}/update`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "my-repo-updated" }),
        }
      )
    )
    expect(patchRes.status).toBe(200)
    const patched = (await patchRes.json()) as {
      data: { id: string; name: string }
    }
    expect(patched.data.name).toBe("my-repo-updated")
  })

  it("creates git host providers and lists them", async () => {
    await truncateAllTables(ctx.client)
    const res = await ctx.app.handle(
      new Request("http://localhost/api/factory/build/git-host-providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: "github-main",
          name: "GitHub Main",
          type: "github",
          spec: {
            apiUrl: "https://api.github.com",
            authMode: "token",
          },
        }),
      })
    )
    expect(res.status).toBe(200)
    const created = (await res.json()) as {
      data: { id: string; slug: string; name: string; type: string }
    }
    expect(created.data.slug).toBe("github-main")
    expect(created.data.type).toBe("github")

    const list = await ctx.app.handle(
      new Request("http://localhost/api/factory/build/git-host-providers")
    )
    expect(list.status).toBe(200)
    const listBody = (await list.json()) as {
      data: { slug: string }[]
      meta: { total: number }
    }
    expect(listBody.data.some((p) => p.slug === "github-main")).toBe(true)
    expect(listBody.meta.total).toBeGreaterThan(0)
  })
})
