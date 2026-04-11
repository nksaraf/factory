import type { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  type TestApp,
  createTestContext,
  truncateAllTables,
} from "../test-helpers"

interface ApiResponse<T = Record<string, unknown>> {
  data: T
}
interface ApiListResponse<T = Record<string, unknown>> {
  data: T[]
}

const BASE = "http://localhost/api/factory/ops/workbenches"

function post(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function patch(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function del(url: string) {
  return new Request(url, { method: "DELETE" })
}

describe("Workbench Controller (v2)", () => {
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

  async function createWorkbench(overrides?: Record<string, unknown>) {
    const res = await app.handle(
      post(BASE, {
        name: "test-workbench",
        slug: "test-workbench",
        type: "developer",
        ownerId: "user_1",
        spec: {
          realmType: "container",
          ...(overrides?.spec as Record<string, unknown>),
        },
        ...Object.fromEntries(
          Object.entries(overrides ?? {}).filter(([k]) => k !== "spec")
        ),
      })
    )
    return res
  }

  // =========================================================================
  // Workbench CRUD
  // =========================================================================
  describe("Workbench CRUD", () => {
    it("POST /workbenches creates workbench and returns id", async () => {
      const res = await createWorkbench()
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse
      expect(data.id).toBeTruthy()
      expect(data.name).toBe("test-workbench")
    })

    it("GET /workbenches lists workbenches", async () => {
      await createWorkbench({ name: "wb-1", slug: "wb-1" })
      await createWorkbench({ name: "wb-2", slug: "wb-2" })

      const res = await app.handle(new Request(BASE))
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiListResponse
      expect(data).toHaveLength(2)
    })

    it("GET /workbenches/:slugOrId returns detail by slug", async () => {
      await createWorkbench({ slug: "my-workbench" })

      const res = await app.handle(new Request(`${BASE}/my-workbench`))
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<{ slug: string }>
      expect(data.slug).toBe("my-workbench")
    })

    it("GET /workbenches/:slugOrId returns detail by id", async () => {
      const createRes = await createWorkbench()
      const { data: created } = (await createRes.json()) as ApiResponse

      const res = await app.handle(new Request(`${BASE}/${created.id}`))
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse
      expect(data.id).toBe(created.id)
    })

    it("GET /workbenches/:slugOrId returns 404 for nonexistent", async () => {
      const res = await app.handle(new Request(`${BASE}/wkbn_nonexistent`))
      expect(res.status).toBe(404)
    })

    it("POST /workbenches/:slugOrId/update updates workbench", async () => {
      const createRes = await createWorkbench()
      const { data: created } = (await createRes.json()) as ApiResponse

      const res = await app.handle(
        post(`${BASE}/${created.id}/update`, {
          spec: { cpu: "4000m", memory: "8Gi" },
        })
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<{
        spec: Record<string, unknown>
      }>
      expect(data.spec.cpu).toBe("4000m")
      expect(data.spec.memory).toBe("8Gi")
    })

    it("POST /workbenches/:slugOrId/delete soft-deletes (bitemporal)", async () => {
      const createRes = await createWorkbench()
      const { data: created } = (await createRes.json()) as ApiResponse

      const res = await app.handle(post(`${BASE}/${created.id}/delete`, {}))
      expect(res.status).toBe(200)

      // Verify soft-deleted (not returned in list)
      const listRes = await app.handle(new Request(BASE))
      const { data } = (await listRes.json()) as ApiListResponse
      expect(data).toHaveLength(0)
    })
  })

  // =========================================================================
  // Lifecycle Actions
  // =========================================================================
  describe("Lifecycle Actions", () => {
    it("POST /workbenches/:id/start sets lifecycle to active", async () => {
      const createRes = await createWorkbench()
      const { data: created } = (await createRes.json()) as ApiResponse

      const res = await app.handle(post(`${BASE}/${created.id}/start`, {}))
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<{
        spec: { lifecycle: string }
      }>
      expect(data.spec.lifecycle).toBe("active")
    })

    it("POST /workbenches/:id/stop sets lifecycle to suspended", async () => {
      const createRes = await createWorkbench()
      const { data: created } = (await createRes.json()) as ApiResponse

      await app.handle(post(`${BASE}/${created.id}/start`, {}))

      const res = await app.handle(post(`${BASE}/${created.id}/stop`, {}))
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<{
        spec: { lifecycle: string }
      }>
      expect(data.spec.lifecycle).toBe("suspended")
    })

    it("POST /workbenches/:id/extend updates expiresAt in spec", async () => {
      const createRes = await createWorkbench({
        spec: { expiresAt: new Date(Date.now() + 3600_000).toISOString() },
      })
      const { data: created } = (await createRes.json()) as ApiResponse

      const res = await app.handle(
        post(`${BASE}/${created.id}/extend`, { minutes: 120 })
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<{
        spec: { expiresAt: string }
      }>
      expect(data.spec.expiresAt).toBeTruthy()
    })

    it("POST /workbenches/:id/start returns 404 for nonexistent", async () => {
      const res = await app.handle(post(`${BASE}/wkbn_nonexistent/start`, {}))
      expect(res.status).toBe(404)
    })
  })

  // =========================================================================
  // Snapshots
  // =========================================================================
  describe("Snapshots", () => {
    it("POST /workbenches/:id/snapshot creates snapshot", async () => {
      const createRes = await createWorkbench()
      const { data: created } = (await createRes.json()) as ApiResponse

      const res = await app.handle(
        post(`${BASE}/${created.id}/snapshot`, {
          name: "my-snapshot",
        })
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<{
        id: string
        spec: { status: string }
      }>
      expect(data.id).toBeTruthy()
      expect(data.spec.status).toBe("creating")
    })

    it("GET /workbenches/:id/snapshots lists snapshots", async () => {
      const createRes = await createWorkbench()
      const { data: created } = (await createRes.json()) as ApiResponse

      await app.handle(
        post(`${BASE}/${created.id}/snapshot`, { name: "snap-1" })
      )
      await app.handle(
        post(`${BASE}/${created.id}/snapshot`, { name: "snap-2" })
      )

      const res = await app.handle(
        new Request(`${BASE}/${created.id}/snapshots`)
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiListResponse
      expect(data).toHaveLength(2)
    })
  })
})
