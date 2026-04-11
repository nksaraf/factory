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

const BASE = "http://localhost/api/v1/factory/fleet/workspaces"

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

describe("Workspace Controller (v2)", () => {
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

  async function createWorkspace(overrides?: Record<string, unknown>) {
    const res = await app.handle(
      post(BASE, {
        name: "test-workspace",
        slug: "test-workspace",
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
  // Workspace CRUD
  // =========================================================================
  describe("Workspace CRUD", () => {
    it("POST /workspaces creates workspace and returns id", async () => {
      const res = await createWorkspace()
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse
      expect(data.id).toBeTruthy()
      expect(data.name).toBe("test-workspace")
    })

    it("GET /workspaces lists workspaces", async () => {
      await createWorkspace({ name: "ws-1", slug: "ws-1" })
      await createWorkspace({ name: "ws-2", slug: "ws-2" })

      const res = await app.handle(new Request(BASE))
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiListResponse
      expect(data).toHaveLength(2)
    })

    it("GET /workspaces/:slugOrId returns detail by slug", async () => {
      await createWorkspace({ slug: "my-workspace" })

      const res = await app.handle(new Request(`${BASE}/my-workspace`))
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<{ slug: string }>
      expect(data.slug).toBe("my-workspace")
    })

    it("GET /workspaces/:slugOrId returns detail by id", async () => {
      const createRes = await createWorkspace()
      const { data: created } = (await createRes.json()) as ApiResponse

      const res = await app.handle(new Request(`${BASE}/${created.id}`))
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse
      expect(data.id).toBe(created.id)
    })

    it("GET /workspaces/:slugOrId returns 404 for nonexistent", async () => {
      const res = await app.handle(new Request(`${BASE}/wksp_nonexistent`))
      expect(res.status).toBe(404)
    })

    it("POST /workspaces/:slugOrId/update updates workspace", async () => {
      const createRes = await createWorkspace()
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

    it("POST /workspaces/:slugOrId/delete soft-deletes (bitemporal)", async () => {
      const createRes = await createWorkspace()
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
    it("POST /workspaces/:id/start sets lifecycle to active", async () => {
      const createRes = await createWorkspace()
      const { data: created } = (await createRes.json()) as ApiResponse

      const res = await app.handle(post(`${BASE}/${created.id}/start`, {}))
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<{
        spec: { lifecycle: string }
      }>
      expect(data.spec.lifecycle).toBe("active")
    })

    it("POST /workspaces/:id/stop sets lifecycle to suspended", async () => {
      const createRes = await createWorkspace()
      const { data: created } = (await createRes.json()) as ApiResponse

      await app.handle(post(`${BASE}/${created.id}/start`, {}))

      const res = await app.handle(post(`${BASE}/${created.id}/stop`, {}))
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<{
        spec: { lifecycle: string }
      }>
      expect(data.spec.lifecycle).toBe("suspended")
    })

    it("POST /workspaces/:id/extend updates expiresAt in spec", async () => {
      const createRes = await createWorkspace({
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

    it("POST /workspaces/:id/start returns 404 for nonexistent", async () => {
      const res = await app.handle(post(`${BASE}/wksp_nonexistent/start`, {}))
      expect(res.status).toBe(404)
    })
  })

  // =========================================================================
  // Snapshots
  // =========================================================================
  describe("Snapshots", () => {
    it("POST /workspaces/:id/snapshot creates snapshot", async () => {
      const createRes = await createWorkspace()
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

    it("GET /workspaces/:id/snapshots lists snapshots", async () => {
      const createRes = await createWorkspace()
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
