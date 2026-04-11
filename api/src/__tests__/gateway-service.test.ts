import type { PGlite } from "@electric-sql/pglite"
import type {
  EstateSpec,
  RealmSpec,
  RouteSpec,
} from "@smp/factory-shared/schemas/infra"
import type {
  SiteSpec,
  SystemDeploymentSpec,
} from "@smp/factory-shared/schemas/ops"
import type { PrincipalSpec } from "@smp/factory-shared/schemas/org"
import type { SystemSpec } from "@smp/factory-shared/schemas/software"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import type { Database } from "../db/connection"
import { estate, realm } from "../db/schema/infra-v2"
import { site, systemDeployment } from "../db/schema/ops"
import { principal } from "../db/schema/org-v2"
import { system } from "../db/schema/software-v2"
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
        spec: {
          type: "shared",
          status: "provisioning",
          product: "test-product",
        } satisfies SiteSpec,
      })
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
        domain: "api.test.dx.dev",
        targetService: "api-svc",
        createdBy: "test",
      })
      expect(r.id).toBeTruthy()
      expect(r.domain).toBe("api.test.dx.dev")

      const { data, total } = await gw.listRoutes(db)
      expect(data).toHaveLength(1)
      expect(total).toBe(1)
    })

    it("gets route by id", async () => {
      const created = await gw.createRoute(db, {
        type: "ingress",
        domain: "api.test.dx.dev",
        targetService: "api-svc",
        createdBy: "test",
      })

      const fetched = await gw.getRoute(db, created.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.id).toBe(created.id)
      expect(fetched!.type).toBe("ingress")
      expect(fetched!.domain).toBe("api.test.dx.dev")
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
        domain: "api.test.dx.dev",
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
        domain: "api.test.dx.dev",
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
        domain: "api.test.dx.dev",
        targetService: "api-svc",
        createdBy: "test",
      })
      await gw.createRoute(db, {
        type: "workbench",
        domain: "workbench.test.dx.dev",
        targetService: "workbench-svc",
        createdBy: "test",
      })

      const { data, total } = await gw.listRoutes(db, { type: "workbench" })
      expect(data).toHaveLength(1)
      expect(total).toBe(1)
      expect(data[0].type).toBe("workbench")
    })

    it("cleans up expired routes", async () => {
      await gw.createRoute(db, {
        type: "ingress",
        domain: "expired.test.dx.dev",
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
      expect(dSpec.dnsVerified).toBe(false)
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
      expect(updatedSpec.dnsVerified).toBe(true)
      expect(updatedSpec.status).toBe("verified")
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
      const { site: s, system: sys } = await createSystemDeploymentPrereqs()
      const [sd] = await db
        .insert(systemDeployment)
        .values({
          name: `workbench-${Date.now()}`,
          slug: `workbench-${Date.now()}`,
          type: "dev",
          systemId: sys.id,
          siteId: s.id,
          spec: {
            trigger: "manual",
            createdBy: "test",
            status: "provisioning",
            deploymentStrategy: "rolling",
            labels: {},
            runtime: "kubernetes",
          } satisfies SystemDeploymentSpec,
        })
        .returning()

      const routes = await gw.createWorkbenchRoutes(db, {
        workbenchSlug: "my-workbench",
        systemDeploymentId: sd.id,
        publishPorts: [3000, 8080],
        createdBy: "test",
      })

      expect(routes).toHaveLength(3)

      const primary = routes.find(
        (r) => r.domain === "my-workbench.workbench.dx.dev"
      )
      expect(primary).toBeTruthy()

      const port3000 = routes.find(
        (r) => r.domain === "my-workbench-3000.workbench.dx.dev"
      )
      expect(port3000).toBeTruthy()

      const port8080 = routes.find(
        (r) => r.domain === "my-workbench-8080.workbench.dx.dev"
      )
      expect(port8080).toBeTruthy()
    })

    it("creates workbench routes for site", async () => {
      const { site: s, system: sys } = await createSystemDeploymentPrereqs()
      const [sd] = await db
        .insert(systemDeployment)
        .values({
          name: `workbench-site-${Date.now()}`,
          slug: `workbench-site-${Date.now()}`,
          type: "dev",
          systemId: sys.id,
          siteId: s.id,
          spec: {
            trigger: "manual",
            createdBy: "test",
            status: "provisioning",
            deploymentStrategy: "rolling",
            labels: {},
            runtime: "kubernetes",
          } satisfies SystemDeploymentSpec,
        })
        .returning()

      const routes = await gw.createWorkbenchRoutes(db, {
        workbenchSlug: "my-workbench",
        systemDeploymentId: sd.id,
        siteId: s.id,
        createdBy: "test",
      })

      expect(routes).toHaveLength(1)
      expect(routes[0].domain).toBe(`my-workbench.${s.id}.dx.dev`)
    })

    it("removes target routes", async () => {
      const { site: s, system: sys } = await createSystemDeploymentPrereqs()
      const [sd] = await db
        .insert(systemDeployment)
        .values({
          name: `workbench-${Date.now()}`,
          slug: `workbench-${Date.now()}`,
          type: "dev",
          systemId: sys.id,
          siteId: s.id,
          spec: {
            trigger: "manual",
            createdBy: "test",
            status: "provisioning",
            deploymentStrategy: "rolling",
            labels: {},
            runtime: "kubernetes",
          } satisfies SystemDeploymentSpec,
        })
        .returning()

      await gw.createWorkbenchRoutes(db, {
        workbenchSlug: "my-workbench",
        systemDeploymentId: sd.id,
        publishPorts: [3000],
        createdBy: "test",
      })

      const removed = await gw.removeSystemDeploymentRoutes(db, sd.id)
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
      expect(r.domain).toBe("test-tunnel.tunnel.dx.dev")
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
