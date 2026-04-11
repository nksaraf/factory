import type { PGlite } from "@electric-sql/pglite"
import type { PreviewSpec } from "@smp/factory-shared/schemas/ops"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  type TestApp,
  createTestContext,
  truncateAllTables,
} from "../test-helpers"

interface ApiResponse<T = unknown> {
  data: T
}
interface ApiListResponse<T = unknown> {
  data: T[]
}

interface PreviewRow {
  id: string
  phase: string
  prNumber: number
  sourceBranch: string
  spec: PreviewSpec
}

const BASE = "http://localhost/api/factory/ops/previews"

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

describe("Preview Controller (v2)", () => {
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

  async function createPreview(overrides?: Record<string, unknown>) {
    const res = await app.handle(
      post(BASE, {
        siteId: "site_default",
        sourceBranch: "feat/auth-fix",
        prNumber: 42,
        spec: {
          commitSha: "abc123def456",
          repo: "myorg/myrepo",
          ownerId: "user_1",
          createdBy: "user_1",
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
  // Preview CRUD
  // =========================================================================
  describe("Preview CRUD", () => {
    it("POST /previews creates preview in pending_image phase", async () => {
      const res = await createPreview()
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<PreviewRow>
      expect(data.id).toBeTruthy()
      expect(data.phase).toBe("pending_image")
    })

    it("POST /previews stores spec fields", async () => {
      const res = await createPreview({
        spec: {
          commitSha: "abc123def456",
          imageRef: "ghcr.io/myorg/myapp:pr-42",
        },
      })
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<PreviewRow>
      expect(data.spec.imageRef).toBe("ghcr.io/myorg/myapp:pr-42")
    })

    it("GET /previews lists previews", async () => {
      await createPreview({ sourceBranch: "branch-a", prNumber: 1 })
      await createPreview({ sourceBranch: "branch-b", prNumber: 2 })

      const res = await app.handle(new Request(BASE))
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiListResponse<PreviewRow>
      expect(data).toHaveLength(2)
    })

    it("GET /previews/:id returns preview by id", async () => {
      const createRes = await createPreview()
      const { data: created } =
        (await createRes.json()) as ApiResponse<PreviewRow>

      const res = await app.handle(new Request(`${BASE}/${created.id}`))
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<PreviewRow>
      expect(data.id).toBe(created.id)
      expect(data.prNumber).toBe(42)
      expect(data.sourceBranch).toBe("feat/auth-fix")
    })

    it("GET /previews/:id returns 404 for nonexistent", async () => {
      const res = await app.handle(new Request(`${BASE}/nonexistent-id`))
      expect(res.status).toBe(404)
    })
  })

  // =========================================================================
  // Lifecycle Actions
  // =========================================================================
  describe("Lifecycle Actions", () => {
    it("POST /previews/:id/image transitions to deploying phase", async () => {
      const createRes = await createPreview()
      const { data: created } =
        (await createRes.json()) as ApiResponse<PreviewRow>

      const res = await app.handle(
        post(`${BASE}/${created.id}/image`, {
          imageRef: "ghcr.io/myorg/app:pr-42",
        })
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<PreviewRow>
      expect(data.phase).toBe("deploying")
      expect(data.spec.imageRef).toBe("ghcr.io/myorg/app:pr-42")
    })

    it("POST /previews/:id/expire expires a preview", async () => {
      const createRes = await createPreview()
      const { data: created } =
        (await createRes.json()) as ApiResponse<PreviewRow>

      const res = await app.handle(post(`${BASE}/${created.id}/expire`, {}))
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<PreviewRow>
      expect(data.phase).toBe("expired")
    })

    it("POST /previews/:id/extend extends preview expiry", async () => {
      const createRes = await createPreview()
      const { data: created } =
        (await createRes.json()) as ApiResponse<PreviewRow>

      const res = await app.handle(
        post(`${BASE}/${created.id}/extend`, { minutes: 14 * 24 * 60 })
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<PreviewRow>
      expect(data.spec.expiresAt).toBeTruthy()
    })

    it("POST /previews/:id/delete soft-deletes preview", async () => {
      const createRes = await createPreview()
      const { data: created } =
        (await createRes.json()) as ApiResponse<PreviewRow>

      const res = await app.handle(del(`${BASE}/${created.id}`))
      expect(res.status).toBe(200)

      // Verify not returned in list
      const listRes = await app.handle(new Request(BASE))
      const { data } = (await listRes.json()) as ApiListResponse<PreviewRow>
      expect(data).toHaveLength(0)
    })
  })
})
