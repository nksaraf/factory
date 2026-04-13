/**
 * Workbench Controller Tests
 *
 * Tests workbench CRUD via /ops/workbenches endpoints.
 */
import type { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"

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

const BASE = "http://localhost/api/v1/factory/ops/workbenches"

function post(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function del(url: string) {
  return new Request(`${url}/delete`, { method: "POST" })
}

describe("Workbench Controller", () => {
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

  // Helper to create a workbench via the API
  async function createWorkbench(overrides?: Record<string, unknown>) {
    const ts = Date.now()
    const res = await app.handle(
      post(`${BASE}`, {
        slug: `test-workbench-${ts}`,
        name: "test-workbench",
        type: "developer",
        ownerId: "user_1",
        spec: {},
        ...overrides,
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
      await createWorkbench({ slug: "wb-1", name: "wb-1" })
      await createWorkbench({ slug: "wb-2", name: "wb-2" })

      const res = await app.handle(new Request(`${BASE}`))
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiListResponse
      expect(data).toHaveLength(2)
    })

    it("GET /workbenches/:id returns detail", async () => {
      const createRes = await createWorkbench()
      const { data: created } = (await createRes.json()) as ApiResponse<{
        id: string
      }>

      const res = await app.handle(new Request(`${BASE}/${created.id}`))
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<{
        id: string
        spec: { lifecycle: string }
      }>
      expect(data.id).toBe(created.id)
      // provisioning lifecycle is set in beforeCreate hook
      expect(data.spec.lifecycle).toBe("provisioning")
    })

    it("GET /workbenches/:id returns 404 for nonexistent", async () => {
      const res = await app.handle(new Request(`${BASE}/wkbn_nonexistent`))
      expect(res.status).toBe(404)
    })

    it("POST /workbenches/:id/delete marks workbench as deleted (bitemporal)", async () => {
      const createRes = await createWorkbench()
      const { data: created } = (await createRes.json()) as ApiResponse

      const res = await app.handle(del(`${BASE}/${created.id}`))
      expect(res.status).toBe(200)

      // Verify not returned in list (bitemporal delete sets validTo)
      const listRes = await app.handle(new Request(`${BASE}`))
      const { data } = (await listRes.json()) as ApiListResponse
      expect(data).toHaveLength(0)
    })

    it("POST /workbenches/:id/delete returns 404 for nonexistent", async () => {
      const res = await app.handle(del(`${BASE}/wkbn_nonexistent`))
      expect(res.status).toBe(404)
    })
  })

  // =========================================================================
  // Lifecycle
  // =========================================================================
  describe("Lifecycle", () => {
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

    it("POST /workbenches/:id/resize updates cpu/memory/storageGb in spec", async () => {
      const createRes = await createWorkbench()
      const { data: created } = (await createRes.json()) as ApiResponse

      const res = await app.handle(
        post(`${BASE}/${created.id}/resize`, {
          cpu: "4000m",
          memory: "8Gi",
          storageGb: 50,
        })
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<{
        spec: { cpu: string; memory: string; storageGb: number }
      }>
      expect(data.spec.cpu).toBe("4000m")
      expect(data.spec.memory).toBe("8Gi")
      expect(data.spec.storageGb).toBe(50)
    })

    it("POST /workbenches/:id/extend updates expiresAt in spec", async () => {
      const createRes = await createWorkbench()
      const { data: created } = (await createRes.json()) as ApiResponse

      const res = await app.handle(
        post(`${BASE}/${created.id}/extend`, {
          minutes: 120,
        })
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
          description: "A test snapshot",
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
