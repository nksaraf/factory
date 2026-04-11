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

const BASE = "http://localhost/api/v1/factory/infra"

function post(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

// ontologyRoutes uses POST /:id/update (not PATCH)
function update(url: string, body: Record<string, unknown>) {
  return new Request(`${url}/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

// ontologyRoutes uses POST /:id/delete (not DELETE)
function del(url: string) {
  return new Request(`${url}/delete`, { method: "POST" })
}

describe("Infra Controller", () => {
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

  // ==========================================================================
  // Estates
  // ==========================================================================
  describe("estates", () => {
    it("POST creates and GET lists estates", async () => {
      const create = await app.handle(
        post(`${BASE}/estates`, {
          name: "test-estate",
          slug: "test-estate",
          type: "datacenter",
          spec: {},
        })
      )
      expect(create.status).toBe(200)
      const { data: created } = (await create.json()) as ApiResponse
      expect(created.id).toBeTruthy()
      expect(created.slug).toBe("test-estate")

      const list = await app.handle(new Request(`${BASE}/estates`))
      const { data } = (await list.json()) as ApiListResponse
      expect(data).toHaveLength(1)
    })

    it("GET /estates/:slugOrId returns detail by slug", async () => {
      await app.handle(
        post(`${BASE}/estates`, {
          name: "my-estate",
          slug: "my-estate",
          type: "vpc",
          spec: {},
        })
      )

      const res = await app.handle(new Request(`${BASE}/estates/my-estate`))
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse
      expect(data.name).toBe("my-estate")
      expect(data.type).toBe("vpc")
    })

    it("GET /estates/:slugOrId returns 404 for missing", async () => {
      const res = await app.handle(
        new Request(`${BASE}/estates/sub_nonexistent`)
      )
      expect(res.status).toBe(404)
    })

    it("POST /estates/:slugOrId/update updates estate", async () => {
      const createRes = await app.handle(
        post(`${BASE}/estates`, {
          name: "update-me",
          slug: "update-me",
          type: "datacenter",
          spec: {},
        })
      )
      const { data: created } = (await createRes.json()) as ApiResponse

      const res = await app.handle(
        update(`${BASE}/estates/${created.id}`, {
          spec: { location: "us-east" },
        })
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<{
        spec: Record<string, unknown>
      }>
      expect(data.spec.location).toBe("us-east")
    })

    it("POST /estates/:slugOrId/delete soft-deletes", async () => {
      const createRes = await app.handle(
        post(`${BASE}/estates`, {
          name: "delete-me",
          slug: "delete-me",
          type: "datacenter",
          spec: {},
        })
      )
      const { data: created } = (await createRes.json()) as ApiResponse

      const res = await app.handle(del(`${BASE}/estates/${created.id}`))
      expect(res.status).toBe(200)

      const list = await app.handle(new Request(`${BASE}/estates`))
      const { data } = (await list.json()) as ApiListResponse
      expect(data).toHaveLength(0)
    })

    it("GET /estates/:id/hosts returns related hosts", async () => {
      const subRes = await app.handle(
        post(`${BASE}/estates`, {
          name: "sub-with-hosts",
          slug: "sub-with-hosts",
          type: "datacenter",
          spec: {},
        })
      )
      const { data: sub } = (await subRes.json()) as ApiResponse

      await app.handle(
        post(`${BASE}/hosts`, {
          name: "host-1",
          slug: "host-1",
          type: "bare-metal",
          estateId: sub.id,
          spec: { hostname: "host-1.local" },
        })
      )

      const res = await app.handle(
        new Request(`${BASE}/estates/${sub.id}/hosts`)
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiListResponse
      expect(data).toHaveLength(1)
      expect(data[0].name).toBe("host-1")
    })
  })

  // ==========================================================================
  // Hosts
  // ==========================================================================
  describe("hosts", () => {
    it("POST creates and GET lists hosts", async () => {
      const subRes = await app.handle(
        post(`${BASE}/estates`, {
          name: "host-sub",
          slug: "host-sub",
          type: "datacenter",
          spec: {},
        })
      )
      const { data: sub } = (await subRes.json()) as ApiResponse

      const create = await app.handle(
        post(`${BASE}/hosts`, {
          name: "test-host",
          slug: "test-host",
          type: "bare-metal",
          estateId: sub.id,
          spec: {
            hostname: "test-host.local",
            arch: "amd64",
            cpu: 16,
            memoryMb: 65536,
          },
        })
      )
      expect(create.status).toBe(200)
      const { data: created } = (await create.json()) as ApiResponse
      expect(created.id).toBeTruthy()

      const list = await app.handle(new Request(`${BASE}/hosts`))
      const { data } = (await list.json()) as ApiListResponse
      expect(data).toHaveLength(1)
    })

    it("GET /hosts/:slugOrId returns detail", async () => {
      const subRes = await app.handle(
        post(`${BASE}/estates`, {
          name: "h-sub",
          slug: "h-sub",
          type: "datacenter",
          spec: {},
        })
      )
      const { data: sub } = (await subRes.json()) as ApiResponse

      await app.handle(
        post(`${BASE}/hosts`, {
          name: "detail-host",
          slug: "detail-host",
          type: "bare-metal",
          estateId: sub.id,
          spec: { hostname: "detail-host.local", arch: "arm64" },
        })
      )

      const res = await app.handle(new Request(`${BASE}/hosts/detail-host`))
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<{
        spec: Record<string, unknown>
      }>
      expect(data.spec.arch).toBe("arm64")
    })

    it("POST /hosts/:slugOrId/delete soft-deletes", async () => {
      const subRes = await app.handle(
        post(`${BASE}/estates`, {
          name: "del-sub",
          slug: "del-sub",
          type: "datacenter",
          spec: {},
        })
      )
      const { data: sub } = (await subRes.json()) as ApiResponse

      const createRes = await app.handle(
        post(`${BASE}/hosts`, {
          name: "del-host",
          slug: "del-host",
          type: "bare-metal",
          estateId: sub.id,
          spec: { hostname: "del-host.local" },
        })
      )
      const { data: created } = (await createRes.json()) as ApiResponse

      const res = await app.handle(del(`${BASE}/hosts/${created.id}`))
      expect(res.status).toBe(200)

      const list = await app.handle(new Request(`${BASE}/hosts`))
      const { data } = (await list.json()) as ApiListResponse
      expect(data).toHaveLength(0)
    })

    it("GET /hosts/:id/realms returns related realms", async () => {
      const subRes = await app.handle(
        post(`${BASE}/estates`, {
          name: "rt-sub",
          slug: "rt-sub",
          type: "datacenter",
          spec: {},
        })
      )
      const { data: sub } = (await subRes.json()) as ApiResponse

      const hostRes = await app.handle(
        post(`${BASE}/hosts`, {
          name: "rt-host",
          slug: "rt-host",
          type: "bare-metal",
          estateId: sub.id,
          spec: { hostname: "rt-host.local" },
        })
      )
      const { data: h } = (await hostRes.json()) as ApiResponse

      const realmCreate = await app.handle(
        post(`${BASE}/realms`, {
          name: "k3s-realm",
          slug: "k3s-realm",
          type: "k8s-cluster",
          spec: { kubeconfigRef: "fake-kc", status: "ready" },
        })
      )
      const { data: realmEntity } = (await realmCreate.json()) as ApiResponse

      await client.query(
        `insert into infra.realm_host (realm_id, host_id, role) values ($1, $2, 'single')`,
        [realmEntity.id, h.id]
      )

      const res = await app.handle(new Request(`${BASE}/hosts/${h.id}/realms`))
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiListResponse
      expect(data).toHaveLength(1)
      expect(data[0].realmId).toBe(realmEntity.id)
      expect(data[0].hostId).toBe(h.id)
    })
  })

  // ==========================================================================
  // Realms
  // ==========================================================================
  describe("realms", () => {
    it("POST creates and GET lists realms", async () => {
      const create = await app.handle(
        post(`${BASE}/realms`, {
          name: "test-realm",
          slug: "test-realm",
          type: "k8s-cluster",
          spec: { kubeconfigRef: "fake-kc", status: "ready" },
        })
      )
      expect(create.status).toBe(200)
      const { data: created } = (await create.json()) as ApiResponse
      expect(created.id).toBeTruthy()

      const list = await app.handle(new Request(`${BASE}/realms`))
      const { data } = (await list.json()) as ApiListResponse
      expect(data.some((r: any) => r.slug === "test-realm")).toBe(true)
    })

    it("GET /realms/:slugOrId returns detail by slug", async () => {
      await app.handle(
        post(`${BASE}/realms`, {
          name: "my-realm",
          slug: "my-realm",
          type: "k8s-cluster",
          spec: { kubeconfigRef: "kc-data", status: "provisioning" },
        })
      )

      const res = await app.handle(new Request(`${BASE}/realms/my-realm`))
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<{
        name: string
        spec: Record<string, unknown>
      }>
      expect(data.name).toBe("my-realm")
      expect(data.spec.status).toBe("provisioning")
    })

    it("GET /realms/:slugOrId returns 404 for missing", async () => {
      const res = await app.handle(
        new Request(`${BASE}/realms/rtm_nonexistent`)
      )
      expect(res.status).toBe(404)
    })

    it("POST /realms/:slugOrId/update updates realm", async () => {
      const createRes = await app.handle(
        post(`${BASE}/realms`, {
          name: "update-rt",
          slug: "update-rt",
          type: "k8s-cluster",
          spec: { kubeconfigRef: "kc", status: "provisioning" },
        })
      )
      const { data: created } = (await createRes.json()) as ApiResponse

      const res = await app.handle(
        update(`${BASE}/realms/${created.id}`, {
          spec: { status: "ready" },
        })
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<{
        spec: Record<string, unknown>
      }>
      expect(data.spec.status).toBe("ready")
    })

    it("POST /realms/:slugOrId/delete soft-deletes", async () => {
      const createRes = await app.handle(
        post(`${BASE}/realms`, {
          name: "del-rt",
          slug: "del-rt",
          type: "k8s-cluster",
          spec: { kubeconfigRef: "kc", status: "ready" },
        })
      )
      const { data: created } = (await createRes.json()) as ApiResponse

      const res = await app.handle(del(`${BASE}/realms/${created.id}`))
      expect(res.status).toBe(200)

      const list = await app.handle(new Request(`${BASE}/realms`))
      const { data } = (await list.json()) as ApiListResponse
      expect(data.some((r: any) => r.slug === "del-rt")).toBe(false)
    })
  })

  // ==========================================================================
  // Routes
  // ==========================================================================
  describe("routes", () => {
    it("POST creates and GET lists routes", async () => {
      const create = await app.handle(
        post(`${BASE}/routes`, {
          name: "test-route",
          slug: "test-route",
          type: "tunnel",
          domain: "app.tunnel.dx.dev",
          spec: { targetService: "tunnel-broker" },
        })
      )
      expect(create.status).toBe(200)
      const { data: created } = (await create.json()) as ApiResponse
      expect(created.id).toBeTruthy()

      const list = await app.handle(new Request(`${BASE}/routes`))
      const { data } = (await list.json()) as ApiListResponse
      expect(data).toHaveLength(1)
    })

    it("POST /routes/:slugOrId/delete soft-deletes", async () => {
      const createRes = await app.handle(
        post(`${BASE}/routes`, {
          name: "del-route",
          slug: "del-route",
          type: "preview",
          domain: "pr-1.preview.dx.dev",
          spec: {},
        })
      )
      const { data: created } = (await createRes.json()) as ApiResponse

      const res = await app.handle(del(`${BASE}/routes/${created.id}`))
      expect(res.status).toBe(200)

      const list = await app.handle(new Request(`${BASE}/routes`))
      const { data } = (await list.json()) as ApiListResponse
      expect(data).toHaveLength(0)
    })
  })

  // ==========================================================================
  // DNS Domains
  // ==========================================================================
  describe("dns-domains", () => {
    it("POST creates and GET lists DNS domains", async () => {
      const create = await app.handle(
        post(`${BASE}/dns-domains`, {
          name: "dx.dev",
          slug: "dx-dev",
          type: "primary",
          fqdn: "dx.dev",
          spec: { zone: "dx.dev", provider: "cloudflare" },
        })
      )
      expect(create.status).toBe(200)
      const { data: created } = (await create.json()) as ApiResponse
      expect(created.id).toBeTruthy()

      const list = await app.handle(new Request(`${BASE}/dns-domains`))
      const { data } = (await list.json()) as ApiListResponse
      expect(data).toHaveLength(1)
    })

    it("POST /dns-domains/:id/verify runs DNS verification flow", async () => {
      const createRes = await app.handle(
        post(`${BASE}/dns-domains`, {
          name: "verify-test",
          slug: "verify-test",
          type: "custom",
          fqdn: "verify-test.dev",
          spec: { zone: "test.dev" },
        })
      )
      const { data: created } = (await createRes.json()) as ApiResponse

      const res = await app.handle(
        post(`${BASE}/dns-domains/${created.id}/verify`, {})
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<{
        verified: boolean
        error?: string
      }>
      expect(data.verified).toBe(false)
      expect(data.error).toBeTruthy()
    })
  })

  // ==========================================================================
  // Secrets
  // ==========================================================================
  describe("secrets", () => {
    it("POST creates and GET lists secrets", async () => {
      const create = await app.handle(
        post(`${BASE}/secrets`, {
          name: "db-password",
          slug: "db-password",
          spec: { name: "db-password", ownerType: "system", ownerId: "sys-1" },
        })
      )
      expect(create.status).toBe(200)

      const list = await app.handle(new Request(`${BASE}/secrets`))
      const { data } = (await list.json()) as ApiListResponse
      expect(data).toHaveLength(1)
    })

    it("POST /secrets/:slugOrId/delete soft-deletes", async () => {
      const createRes = await app.handle(
        post(`${BASE}/secrets`, {
          name: "del-secret",
          slug: "del-secret",
          spec: { name: "del-secret", ownerType: "system", ownerId: "sys-1" },
        })
      )
      const { data: created } = (await createRes.json()) as ApiResponse

      const res = await app.handle(del(`${BASE}/secrets/${created.id}`))
      expect(res.status).toBe(200)

      const list = await app.handle(new Request(`${BASE}/secrets`))
      const { data } = (await list.json()) as ApiListResponse
      expect(data).toHaveLength(0)
    })
  })

  // ==========================================================================
  // Network Links
  // ==========================================================================
  describe("network-links", () => {
    it("POST creates and GET lists network links", async () => {
      // Create two realms to link
      const rt1Res = await app.handle(
        post(`${BASE}/realms`, {
          name: "link-rt-1",
          slug: "link-rt-1",
          type: "k8s-cluster",
          spec: { kubeconfigRef: "kc1", status: "ready" },
        })
      )
      const { data: rt1 } = (await rt1Res.json()) as ApiResponse

      const rt2Res = await app.handle(
        post(`${BASE}/realms`, {
          name: "link-rt-2",
          slug: "link-rt-2",
          type: "k8s-cluster",
          spec: { kubeconfigRef: "kc2", status: "ready" },
        })
      )
      const { data: rt2 } = (await rt2Res.json()) as ApiResponse

      const create = await app.handle(
        post(`${BASE}/network-links`, {
          name: "rt1-to-rt2",
          slug: "rt1-to-rt2",
          type: "mesh",
          sourceId: rt1.id,
          sourceKind: "realm",
          targetId: rt2.id,
          targetKind: "realm",
          spec: {},
        })
      )
      expect(create.status).toBe(200)
      const { data: created } = (await create.json()) as ApiResponse
      expect(created.id).toBeTruthy()

      const list = await app.handle(new Request(`${BASE}/network-links`))
      const { data } = (await list.json()) as ApiListResponse
      expect(data).toHaveLength(1)
    })
  })
})
