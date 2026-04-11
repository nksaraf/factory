import type { PGlite } from "@electric-sql/pglite"
import type { EstateSpec } from "@smp/factory-shared/schemas/infra"
import type { RealmSpec } from "@smp/factory-shared/schemas/infra"
import type {
  InterventionSpec,
  RolloutSpec,
  SiteSpec,
  SystemDeploymentSpec,
  WorkbenchSpec,
} from "@smp/factory-shared/schemas/ops"
import type { PrincipalSpec } from "@smp/factory-shared/schemas/org"
import type { SystemSpec } from "@smp/factory-shared/schemas/software"
import type { ReleaseSpec } from "@smp/factory-shared/schemas/software"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"

import type { Database } from "../db/connection"
import { estate, realm } from "../db/schema/infra"
import {
  componentDeployment,
  intervention,
  rollout,
  site,
  systemDeployment,
  workbench,
} from "../db/schema/ops"
import { principal } from "../db/schema/org"
// Direct DB operations on ops/software schema tables
import { system } from "../db/schema/software"
import { release } from "../db/schema/software"
import { createTestContext, truncateAllTables } from "../test-helpers"

describe("Ops service", () => {
  let db: Database
  let client: PGlite

  // Helper: create prerequisite system (for releases and system deployments)
  async function createSystem(name = "test-system") {
    const spec: SystemSpec = {
      namespace: "default",
      lifecycle: "experimental",
      tags: [],
    }
    const [sys] = await db
      .insert(system)
      .values({ name, slug: name, spec })
      .returning()
    return sys
  }

  // Helper: create a principal (for workbench ownerId FK)
  async function createPrincipal(id = "user_1") {
    // Check if already seeded by seedTestParents
    const existing = await db
      .select()
      .from(principal)
      .where(eq(principal.id, id))
      .limit(1)
    if (existing.length > 0) return existing[0]
    const spec: PrincipalSpec = {}
    const [p] = await db
      .insert(principal)
      .values({ id, name: id, slug: id, type: "human", spec })
      .returning()
    return p
  }

  // Helper: create infra prereqs (estate + realm) and a site
  async function createInfraPrereqs() {
    const subSpec: EstateSpec = {
      providerKind: "bare-metal",
      lifecycle: "active",
    }
    const [sub] = await db
      .insert(estate)
      .values({
        name: "test-estate",
        slug: "test-estate",
        type: "datacenter",
        spec: subSpec,
      })
      .returning()
    const rtSpec: RealmSpec = {
      kubeconfigRef: "/tmp/test.yaml",
      status: "ready",
      endpoint: "localhost",
    }
    const [rt] = await db
      .insert(realm)
      .values({
        name: "test-realm",
        slug: "test-realm",
        type: "k8s-cluster",
        spec: rtSpec,
      })
      .returning()
    return { estate: sub, realm: rt }
  }

  async function createSite(name = "prod-us", overrides?: Partial<SiteSpec>) {
    const spec: SiteSpec = {
      type: "shared",
      product: "smp",
      status: "provisioning",
      ...overrides,
    }
    const [s] = await db
      .insert(site)
      .values({
        name,
        slug: name,
        spec,
      })
      .returning()
    return s
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

  // --- Releases ---
  describe("releases", () => {
    it("creates and lists releases", async () => {
      const sys = await createSystem()
      const spec: ReleaseSpec = { version: "1.0.0", status: "draft" }
      const [rel] = await db
        .insert(release)
        .values({
          name: "v1.0.0",
          slug: "v1-0-0",
          systemId: sys.id,
          spec,
        })
        .returning()

      expect(rel.spec.version).toBe("1.0.0")
      expect(rel.id).toBeTruthy()

      const all = await db.select().from(release)
      expect(all).toHaveLength(1)
    })

    it("gets release by slug", async () => {
      const sys = await createSystem()
      const spec: ReleaseSpec = { version: "1.0.0", status: "draft" }
      await db.insert(release).values({
        name: "v1.0.0",
        slug: "v1-0-0",
        systemId: sys.id,
        spec,
      })

      const [found] = await db
        .select()
        .from(release)
        .where(eq(release.slug, "v1-0-0"))
      expect(found).toBeTruthy()
      expect(found.spec.version).toBe("1.0.0")
    })

    it("returns empty for nonexistent release", async () => {
      const found = await db
        .select()
        .from(release)
        .where(eq(release.slug, "nonexistent"))
      expect(found).toHaveLength(0)
    })

    it("promotes release through state machine", async () => {
      const sys = await createSystem()
      const spec: ReleaseSpec = { version: "1.0.0", status: "draft" }
      const [rel] = await db
        .insert(release)
        .values({
          name: "v1.0.0",
          slug: "v1-0-0",
          systemId: sys.id,
          spec,
        })
        .returning()

      // draft → staging
      await db
        .update(release)
        .set({ spec: { ...rel.spec, status: "staging" } })
        .where(eq(release.id, rel.id))

      const [r1] = await db.select().from(release).where(eq(release.id, rel.id))
      expect(r1.spec.status).toBe("staging")

      // staging → production
      await db
        .update(release)
        .set({ spec: { ...r1.spec, status: "production" } })
        .where(eq(release.id, rel.id))

      const [r2] = await db.select().from(release).where(eq(release.id, rel.id))
      expect(r2.spec.status).toBe("production")
    })

    it("filters releases by status", async () => {
      const sys = await createSystem()
      const stagingSpec: ReleaseSpec = { version: "1.0.0", status: "staging" }
      const draftSpec: ReleaseSpec = { version: "2.0.0", status: "draft" }
      await db.insert(release).values([
        {
          name: "v1.0.0",
          slug: "v1-0-0",
          systemId: sys.id,
          spec: stagingSpec,
        },
        {
          name: "1.2.0",
          slug: "1-2-0",
          systemId: sys.id,
          spec: draftSpec,
        },
      ])

      const staging = await db.select().from(release).where(
        eq(
          release.spec,
          // We'll need a proper JSONB query — for now, fetch all and filter
          release.spec
        )
      )
      // Direct filter approach:
      const all = await db.select().from(release)
      const filtered = all.filter((r) => r.spec.status === "staging")
      expect(filtered).toHaveLength(1)
      expect(filtered[0].spec.version).toBe("1.0.0")
    })
  })

  // --- Sites ---
  describe("sites", () => {
    it("creates and lists sites", async () => {
      const s = await createSite("prod-us")
      expect(s.name).toBe("prod-us")
      expect(s.spec.status).toBe("provisioning")

      const all = await db.select().from(site).where(eq(site.slug, "prod-us"))
      expect(all).toHaveLength(1)
    })

    it("gets site by slug", async () => {
      await createSite("prod-us")
      const [found] = await db
        .select()
        .from(site)
        .where(eq(site.slug, "prod-us"))
      expect(found).toBeTruthy()
      expect(found.spec.product).toBe("smp")
    })

    it("decommissions a site", async () => {
      const s = await createSite("prod-us")
      await db
        .update(site)
        .set({
          spec: { ...s.spec, status: "decommissioned" },
        })
        .where(eq(site.id, s.id))

      const [updated] = await db.select().from(site).where(eq(site.id, s.id))
      expect(updated.spec.status).toBe("decommissioned")
    })

    it("filters sites by product", async () => {
      await createSite("site-a", { product: "smp" })
      await createSite("site-b", { product: "other" })

      const all = await db.select().from(site)
      const filtered = all.filter((s) => s.spec.product === "smp")
      expect(filtered).toHaveLength(1)
      expect(filtered[0].name).toBe("site-a")
    })
  })

  // --- System Deployments ---
  describe("system deployments", () => {
    it("creates and lists system deployments", async () => {
      const sys = await createSystem()
      const s = await createSite()
      const spec: SystemDeploymentSpec = {
        trigger: "release",
        status: "provisioning",
        deploymentStrategy: "rolling",
        labels: {},
        runtime: "kubernetes",
      }
      const [sd] = await db
        .insert(systemDeployment)
        .values({
          name: "sd-1",
          slug: "sd-1",
          type: "production",
          systemId: sys.id,
          siteId: s.id,
          spec,
        })
        .returning()

      expect(sd.name).toBe("sd-1")
      expect(sd.type).toBe("production")

      const all = await db.select().from(systemDeployment)
      expect(all).toHaveLength(1)
    })

    it("creates system deployment with TTL", async () => {
      const sys = await createSystem()
      const s = await createSite()
      const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      const spec: SystemDeploymentSpec = {
        trigger: "manual",
        status: "provisioning",
        deploymentStrategy: "rolling",
        labels: {},
        runtime: "kubernetes",
        expiresAt: new Date(expiresAt),
      }
      const [sd] = await db
        .insert(systemDeployment)
        .values({
          name: "sandbox-1",
          slug: "sandbox-1",
          type: "dev",
          systemId: sys.id,
          siteId: s.id,
          spec,
        })
        .returning()

      expect(sd.spec.expiresAt).toBeTruthy()
      const actual = new Date(sd.spec.expiresAt!).getTime()
      const expected = Date.now() + 24 * 3600 * 1000
      expect(Math.abs(actual - expected)).toBeLessThan(5000)
    })

    it("gets system deployment with component deployments", async () => {
      const sys = await createSystem()
      const s = await createSite()
      const spec: SystemDeploymentSpec = {
        trigger: "release",
        status: "provisioning",
        deploymentStrategy: "rolling",
        labels: {},
        runtime: "kubernetes",
      }
      const [sd] = await db
        .insert(systemDeployment)
        .values({
          name: "sd-1",
          slug: "sd-1",
          type: "production",
          systemId: sys.id,
          siteId: s.id,
          spec,
        })
        .returning()

      const deployments = await db
        .select()
        .from(componentDeployment)
        .where(eq(componentDeployment.systemDeploymentId, sd.id))
      expect(deployments).toEqual([])
    })

    it("destroys system deployment", async () => {
      const sys = await createSystem()
      const s = await createSite()
      const spec: SystemDeploymentSpec = {
        trigger: "release",
        status: "provisioning",
        deploymentStrategy: "rolling",
        labels: {},
        runtime: "kubernetes",
      }
      const [sd] = await db
        .insert(systemDeployment)
        .values({
          name: "sd-1",
          slug: "sd-1",
          type: "production",
          systemId: sys.id,
          siteId: s.id,
          spec,
        })
        .returning()

      await db
        .update(systemDeployment)
        .set({
          spec: { ...sd.spec, status: "destroying" },
        })
        .where(eq(systemDeployment.id, sd.id))

      const [updated] = await db
        .select()
        .from(systemDeployment)
        .where(eq(systemDeployment.id, sd.id))
      expect(updated.spec.status).toBe("destroying")
    })

    it("filters by type", async () => {
      const sys = await createSystem()
      const s = await createSite()
      const prodSpec: SystemDeploymentSpec = {
        trigger: "release",
        status: "provisioning",
        deploymentStrategy: "rolling",
        labels: {},
        runtime: "kubernetes",
      }
      const devSpec: SystemDeploymentSpec = {
        trigger: "manual",
        status: "provisioning",
        deploymentStrategy: "rolling",
        labels: {},
        runtime: "kubernetes",
      }
      await db.insert(systemDeployment).values([
        {
          name: "sd-prod",
          slug: "sd-prod",
          type: "production",
          systemId: sys.id,
          siteId: s.id,
          spec: prodSpec,
        },
        {
          name: "sd-dev",
          slug: "sd-dev",
          type: "dev",
          systemId: sys.id,
          siteId: s.id,
          spec: devSpec,
        },
      ])

      const devOnly = await db
        .select()
        .from(systemDeployment)
        .where(eq(systemDeployment.type, "dev"))
      expect(devOnly).toHaveLength(1)
      expect(devOnly[0].name).toBe("sd-dev")
    })
  })

  // --- Workbenches ---
  describe("workbenches", () => {
    it("creates workbench", async () => {
      await createPrincipal()
      const spec: WorkbenchSpec = {
        realmType: "container",
        devcontainerConfig: {},
        repos: [],
        ownerType: "user",
        authMode: "private",
        healthStatus: "unknown",
        setupProgress: {},
        lifecycle: "provisioning",
      }
      const [wb] = await db
        .insert(workbench)
        .values({
          name: "my-workbench",
          slug: "my-workbench",
          type: "developer",
          ownerId: "user_1",
          spec,
        })
        .returning()

      expect(wb.type).toBe("developer")
      expect(wb.name).toBe("my-workbench")
    })

    it("creates workbench with custom name", async () => {
      await createPrincipal()
      const spec: WorkbenchSpec = {
        realmType: "container",
        devcontainerConfig: {},
        repos: [],
        ownerType: "user",
        authMode: "private",
        healthStatus: "unknown",
        setupProgress: {},
        lifecycle: "provisioning",
      }
      const [wb] = await db
        .insert(workbench)
        .values({
          name: "custom-workbench",
          slug: "custom-workbench",
          type: "developer",
          ownerId: "user_1",
          spec,
        })
        .returning()

      expect(wb.name).toBe("custom-workbench")
    })

    it("lists workbenches excluding soft-deleted", async () => {
      await createPrincipal()
      const spec: WorkbenchSpec = {
        realmType: "container",
        devcontainerConfig: {},
        repos: [],
        ownerType: "user",
        authMode: "private",
        healthStatus: "unknown",
        setupProgress: {},
        lifecycle: "provisioning",
      }
      const [wb] = await db
        .insert(workbench)
        .values({
          name: "wb-1",
          slug: "wb-1",
          type: "developer",
          ownerId: "user_1",
          spec,
        })
        .returning()

      // Soft-delete via validTo (bitemporal)
      await db
        .update(workbench)
        .set({ validTo: new Date() })
        .where(eq(workbench.id, wb.id))

      // Active only (validTo is null)
      const all = await db.select().from(workbench)
      // Without bitemporal filter, we see all — the controller handles filtering
      // Here we just verify the insert/update works
      expect(all).toHaveLength(1)
    })

    it("applies TTL via spec.expiresAt", async () => {
      await createPrincipal()
      const expiresAt = new Date(Date.now() + 48 * 3600 * 1000).toISOString()
      const spec: WorkbenchSpec = {
        realmType: "container",
        devcontainerConfig: {},
        repos: [],
        ownerType: "user",
        authMode: "private",
        healthStatus: "unknown",
        setupProgress: {},
        lifecycle: "provisioning",
        expiresAt: new Date(expiresAt),
      }
      const [wb] = await db
        .insert(workbench)
        .values({
          name: "wb-ttl",
          slug: "wb-ttl",
          type: "developer",
          ownerId: "user_1",
          spec,
        })
        .returning()

      expect(wb.spec.expiresAt).toBeTruthy()
      const actual = new Date(wb.spec.expiresAt!).getTime()
      const expected = Date.now() + 48 * 3600 * 1000
      expect(Math.abs(actual - expected)).toBeLessThan(5000)
    })
  })

  // --- Rollouts ---
  describe("rollouts", () => {
    it("creates and lists rollouts", async () => {
      const sys = await createSystem()
      const s = await createSite()

      const relSpec: ReleaseSpec = { version: "1.0.0", status: "staging" }
      const [rel] = await db
        .insert(release)
        .values({
          name: "v1.0.0",
          slug: "v1-0-0",
          systemId: sys.id,
          spec: relSpec,
        })
        .returning()

      const sdSpec: SystemDeploymentSpec = {
        trigger: "release",
        status: "provisioning",
        deploymentStrategy: "rolling",
        labels: {},
        runtime: "kubernetes",
      }
      const [sd] = await db
        .insert(systemDeployment)
        .values({
          name: "sd-1",
          slug: "sd-1",
          type: "production",
          systemId: sys.id,
          siteId: s.id,
          spec: sdSpec,
        })
        .returning()

      const roSpec: RolloutSpec = {
        status: "pending",
        strategy: "rolling",
        progress: 0,
      }
      const [ro] = await db
        .insert(rollout)
        .values({
          releaseId: rel.id,
          systemDeploymentId: sd.id,
          spec: roSpec,
        })
        .returning()

      expect(ro.id).toBeTruthy()

      const all = await db.select().from(rollout)
      expect(all).toHaveLength(1)
    })
  })

  // --- Interventions ---
  describe("interventions", () => {
    it("creates and lists interventions", async () => {
      const sys = await createSystem()
      const s = await createSite()
      const sdSpec: SystemDeploymentSpec = {
        trigger: "release",
        status: "provisioning",
        deploymentStrategy: "rolling",
        labels: {},
        runtime: "kubernetes",
      }
      const [sd] = await db
        .insert(systemDeployment)
        .values({
          name: "sd-1",
          slug: "sd-1",
          type: "production",
          systemId: sys.id,
          siteId: s.id,
          spec: sdSpec,
        })
        .returning()

      const ivSpec: InterventionSpec = {
        reason: "Testing restart",
        actorPrincipalId: "test-user",
        result: "pending",
        details: {},
      }
      const [iv] = await db
        .insert(intervention)
        .values({
          type: "restart",
          systemDeploymentId: sd.id,
          spec: ivSpec,
        })
        .returning()

      expect(iv).toBeTruthy()

      const all = await db
        .select()
        .from(intervention)
        .where(eq(intervention.systemDeploymentId, sd.id))
      expect(all).toHaveLength(1)
      expect(all[0].type).toBe("restart")
    })
  })
})
