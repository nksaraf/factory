import type { PGlite } from "@electric-sql/pglite"
import type {
  EstateSpec,
  RealmSpec,
  RouteSpec,
} from "@smp/factory-shared/schemas/infra"
import type {
  SiteObservedStatus,
  SiteSpec,
} from "@smp/factory-shared/schemas/ops"
import type { PrincipalSpec } from "@smp/factory-shared/schemas/org"
import type { SystemSpec } from "@smp/factory-shared/schemas/software"
import { eq } from "drizzle-orm"
import dns from "node:dns/promises"
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  spyOn,
} from "bun:test"

import type { Database } from "../db/connection"
import { dnsDomain, estate, realm } from "../db/schema/infra"
import { site } from "../db/schema/ops"
import { principal } from "../db/schema/org"
import { system } from "../db/schema/software"
import * as gw from "../modules/infra/gateway.service"
import { createTestContext, truncateAllTables } from "../test-helpers"

describe("Gateway Service", () => {
  let db: Database
  let client: PGlite

  async function ensurePrincipal(id: string) {
    const [existing] = await db
      .select()
      .from(principal)
      .where(eq(principal.id, id))
      .limit(1)
    if (existing) return existing
    const [p] = await db
      .insert(principal)
      .values({
        id,
        name: id,
        slug: id,
        type: "human",
        spec: {} satisfies PrincipalSpec,
      })
      .returning()
    return p
  }

  async function createInfraPrereqs() {
    const [sub] = await db
      .insert(estate)
      .values({
        name: "test-estate",
        slug: "test-estate",
        type: "hypervisor",
        spec: { providerKind: "proxmox" } satisfies EstateSpec,
      })
      .returning()
    const [rt] = await db
      .insert(realm)
      .values({
        name: "test-realm",
        slug: "test-realm",
        type: "k8s-cluster",
        spec: { kubeconfigRef: "fake-kc", status: "ready" } satisfies RealmSpec,
      })
      .returning()
    return { estate: sub, realm: rt }
  }

  async function createSitePrereqs() {
    const { estate: sub, realm: rt } = await createInfraPrereqs()
    const [s] = await db
      .insert(site)
      .values({
        name: "test-site",
        slug: "test-site",
        type: "production",
        spec: {
          product: "test-product",
          updatePolicy: "auto",
          lifecycle: "persistent",
        } satisfies SiteSpec,
        status: { phase: "provisioning" } satisfies SiteObservedStatus,
      } as typeof site.$inferInsert)
      .returning()
    return { estate: sub, realm: rt, site: s }
  }

  beforeAll(async () => {
    const ctx = await createTestContext()
    db = ctx.db as unknown as Database
    client = ctx.client
  })

  afterAll(async () => {
    await client.close()
  })

  beforeEach(async () => {
    await truncateAllTables(client)
  })

  // ---------------------------------------------------------------------------
  // Route CRUD
  // ---------------------------------------------------------------------------
  describe("route CRUD", () => {
    it("creates and lists routes", async () => {
      const r = await gw.createRoute(db, {
        type: "ingress",
        domain: "api.test.lepton.software",
        targetService: "api-svc",
        createdBy: "test",
      })
      expect(r.id).toBeTruthy()
      expect(r.domain).toBe("api.test.lepton.software")

      const { data, total } = await gw.listRoutes(db)
      expect(data).toHaveLength(1)
      expect(total).toBe(1)
    })

    it("gets route by id", async () => {
      const created = await gw.createRoute(db, {
        type: "ingress",
        domain: "api.test.lepton.software",
        targetService: "api-svc",
        createdBy: "test",
      })

      const fetched = await gw.getRoute(db, created.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.id).toBe(created.id)
      expect(fetched!.type).toBe("ingress")
      expect(fetched!.domain).toBe("api.test.lepton.software")
      expect(fetched!.spec.targetService).toBe("api-svc")
      expect(fetched!.spec.status).toBe("active")
    })

    it("returns null for nonexistent route", async () => {
      const result = await gw.getRoute(db, "rte_nonexistent_000000")
      expect(result).toBeNull()
    })

    it("updates route status", async () => {
      const created = await gw.createRoute(db, {
        type: "ingress",
        domain: "api.test.lepton.software",
        targetService: "api-svc",
        createdBy: "test",
      })

      const updated = await gw.updateRoute(db, created.id, {
        status: "active",
      })
      expect(updated!.spec.status).toBe("active")
    })

    it("deletes route", async () => {
      const created = await gw.createRoute(db, {
        type: "ingress",
        domain: "api.test.lepton.software",
        targetService: "api-svc",
        createdBy: "test",
      })

      await gw.deleteRoute(db, created.id)

      const { data } = await gw.listRoutes(db)
      expect(data).toHaveLength(0)
    })

    it("filters routes by kind", async () => {
      await gw.createRoute(db, {
        type: "ingress",
        domain: "api.test.lepton.software",
        targetService: "api-svc",
        createdBy: "test",
      })
      await gw.createRoute(db, {
        type: "dev",
        domain: "workbench.test.lepton.software",
        targetService: "workbench-svc",
        createdBy: "test",
      })

      const { data, total } = await gw.listRoutes(db, { type: "dev" })
      expect(data).toHaveLength(1)
      expect(total).toBe(1)
      expect(data[0].type).toBe("dev")
    })

    it("cleans up expired routes", async () => {
      await gw.createRoute(db, {
        type: "ingress",
        domain: "expired.test.lepton.software",
        targetService: "api-svc",
        createdBy: "test",
        expiresAt: new Date(Date.now() - 10_000),
      })

      const cleaned = await gw.cleanupExpiredRoutes(db)
      expect(cleaned).toBe(1)

      const { data } = await gw.listRoutes(db)
      expect(data).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Domain Management
  // ---------------------------------------------------------------------------
  describe("domain management", () => {
    it("registers domain with verification token", async () => {
      const d = await gw.registerDomain(db, {
        fqdn: "app.acme.com",
        type: "custom",
        createdBy: "test",
      })

      expect(d.id).toBeTruthy()
      expect(d.fqdn).toBe("app.acme.com")
      const dSpec = d.spec as Record<string, unknown>
      expect(dSpec.verificationToken).toMatch(/^dx-verify-/)
      expect(dSpec.status).toBe("pending")
      expect(dSpec.verified).toBe(false)
    })

    it("gets domain by id and by fqdn", async () => {
      const created = await gw.registerDomain(db, {
        fqdn: "app.acme.com",
        type: "custom",
        createdBy: "test",
      })

      const byId = await gw.getDomain(db, created.id)
      const byFqdn = await gw.getDomainByFqdn(db, "app.acme.com")

      expect(byId).not.toBeNull()
      expect(byFqdn).not.toBeNull()
      expect(byId!.id).toBe(byFqdn!.id)
      expect(byId!.fqdn).toBe("app.acme.com")
    })

    it("updates domain verification", async () => {
      const created = await gw.registerDomain(db, {
        fqdn: "app.acme.com",
        type: "custom",
        createdBy: "test",
      })

      const updated = await gw.updateDomain(db, created.id, {
        dnsVerified: true,
        status: "verified",
      })

      const updatedSpec = updated!.spec as Record<string, unknown>
      expect(updatedSpec.verified).toBe(true)
      expect(updatedSpec.status).toBe("verified")
    })

    it("verifyDomain validates DNS and creates A/AAAA resolution links", async () => {
      const txtSpy = spyOn(dns, "resolveTxt").mockResolvedValue([["token-123"]])
      const v4Spy = spyOn(dns, "resolve4").mockResolvedValue(["203.0.113.20"])
      const v6Spy = spyOn(dns, "resolve6").mockResolvedValue(["2001:db8::10"])
      const created = await gw.registerDomain(db, {
        fqdn: "verify.acme.com",
        type: "custom",
        createdBy: "test",
      })
      await gw.updateDomain(db, created.id, { status: "pending" })
      await db
        .update(dnsDomain)
        .set({
          spec: {
            ...(created.spec as any),
            verificationToken: "token-123",
            verified: false,
          },
        })
        .where(eq(dnsDomain.id, created.id))

      const verified = await gw.verifyDomain(db, created.id)
      expect(verified.verified).toBe(true)
      expect(txtSpy).toHaveBeenCalled()
      expect(v4Spy).toHaveBeenCalled()
      expect(v6Spy).toHaveBeenCalled()

      txtSpy.mockRestore()
      v4Spy.mockRestore()
      v6Spy.mockRestore()
    })

    it("removes domain", async () => {
      const created = await gw.registerDomain(db, {
        fqdn: "app.acme.com",
        type: "custom",
        createdBy: "test",
      })

      await gw.removeDomain(db, created.id)

      const { data } = await gw.listDomains(db)
      expect(data).toHaveLength(0)
    })

    it("enforces unique fqdn", async () => {
      await gw.registerDomain(db, {
        fqdn: "app.acme.com",
        type: "custom",
        createdBy: "test",
      })

      await expect(
        gw.registerDomain(db, {
          fqdn: "app.acme.com",
          type: "custom",
          createdBy: "test",
        })
      ).rejects.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // Workbench Route Helpers
  // ---------------------------------------------------------------------------
  describe("workbench route helpers", () => {
    async function createSystemDeploymentPrereqs() {
      const { site: s } = await createSitePrereqs()
      const [sys] = await db
        .insert(system)
        .values({
          name: "test-system",
          slug: "test-system",
          spec: {
            namespace: "default",
            lifecycle: "experimental",
            tags: [],
          } satisfies SystemSpec,
        })
        .returning()
      return { site: s, system: sys }
    }

    it("creates workbench routes with publish ports", async () => {
      await createSystemDeploymentPrereqs()

      const routes = await gw.createWorkbenchRoutes(db, {
        workbenchSlug: "my-workbench",
        publishPorts: [3000, 8080],
        createdBy: "test",
      })

      expect(routes).toHaveLength(3)

      const primary = routes.find(
        (r) => r.domain === "my-workbench.dev.lepton.software"
      )
      expect(primary).toBeTruthy()

      const port3000 = routes.find(
        (r) => r.domain === "my-workbench-3000.dev.lepton.software"
      )
      expect(port3000).toBeTruthy()

      const port8080 = routes.find(
        (r) => r.domain === "my-workbench-8080.dev.lepton.software"
      )
      expect(port8080).toBeTruthy()
    })

    it("creates workbench routes for site", async () => {
      const { site: s } = await createSystemDeploymentPrereqs()

      const routes = await gw.createWorkbenchRoutes(db, {
        workbenchSlug: "my-workbench",
        siteId: s.id,
        createdBy: "test",
      })

      expect(routes).toHaveLength(1)
      expect(routes[0].domain).toBe(`my-workbench.${s.id}.lepton.software`)
    })

    it("removes target routes", async () => {
      await createSystemDeploymentPrereqs()
      const systemDeploymentId = "sdp-test-remove-routes"

      await gw.createWorkbenchRoutes(db, {
        workbenchSlug: "my-workbench",
        systemDeploymentId,
        publishPorts: [3000],
        createdBy: "test",
      })

      const removed = await gw.removeSystemDeploymentRoutes(
        db,
        systemDeploymentId
      )
      expect(removed).toBe(2)

      const { data } = await gw.listRoutes(db)
      expect(data).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Tunnel Lifecycle
  // ---------------------------------------------------------------------------
  describe("tunnel lifecycle", () => {
    it("registers tunnel with route", async () => {
      await ensurePrincipal("user1")
      const { tunnel: t, route: r } = await gw.registerTunnel(db, {
        subdomain: "test-tunnel",
        principalId: "user1",
        localAddr: "localhost:3000",
        createdBy: "test",
      })

      expect(t.subdomain).toBe("test-tunnel")
      expect(t.phase).toBe("connected")
      expect(r.domain).toBe("test-tunnel.tunnel.lepton.software")
      expect(r.type).toBe("tunnel")
    })

    it("closes tunnel and cascades route", async () => {
      await ensurePrincipal("user1")
      const { tunnel: t, route: r } = await gw.registerTunnel(db, {
        subdomain: "test-tunnel",
        principalId: "user1",
        localAddr: "localhost:3000",
        createdBy: "test",
      })

      await gw.closeTunnel(db, t.id)

      const fetchedTunnel = await gw.getTunnel(db, t.id)
      expect(fetchedTunnel).toBeNull()

      const fetchedRoute = await gw.getRoute(db, r.id)
      expect(fetchedRoute).toBeNull()
    })

    it("heartbeat updates timestamp", async () => {
      await ensurePrincipal("user1")
      const { tunnel: t } = await gw.registerTunnel(db, {
        subdomain: "test-tunnel",
        principalId: "user1",
        localAddr: "localhost:3000",
        createdBy: "test",
      })

      await gw.heartbeatTunnel(db, t.id)

      const updated = await gw.getTunnel(db, t.id)
      expect(updated!.updatedAt).not.toBeNull()
    })

    it("lists tunnels with filters", async () => {
      await ensurePrincipal("user1")
      await ensurePrincipal("user2")
      await gw.registerTunnel(db, {
        subdomain: "tunnel-a",
        principalId: "user1",
        localAddr: "localhost:3000",
        createdBy: "test",
      })
      await gw.registerTunnel(db, {
        subdomain: "tunnel-b",
        principalId: "user2",
        localAddr: "localhost:4000",
        createdBy: "test",
      })

      const { data, total } = await gw.listTunnels(db, {
        principalId: "user1",
      })
      expect(data).toHaveLength(1)
      expect(total).toBe(1)
      expect(data[0].principalId).toBe("user1")
    })
  })
})
