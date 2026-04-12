import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"
import { createTestContext, truncateAllTables } from "../test-helpers"
import * as gw from "../modules/infra/gateway.service"
import * as previewSvc from "../services/preview/preview.service"
import type { Database } from "../db/connection"
import type { PGlite } from "@electric-sql/pglite"
import { preview, site } from "../db/schema/ops"
import { principal } from "../db/schema/org"
import { eq } from "drizzle-orm"
import type { PrincipalSpec } from "@smp/factory-shared/schemas/org"
import type { SiteSpec, PreviewSpec } from "@smp/factory-shared/schemas/ops"
import type { RouteSpec } from "@smp/factory-shared/schemas/infra"

describe("Gateway Services", () => {
  let db: Database
  let client: PGlite

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

  describe("lookupRouteByDomain", () => {
    it("finds an active route by domain", async () => {
      await gw.createRoute(db, {
        type: "tunnel",
        domain: "happy-fox-42.tunnel.dx.dev",
        targetService: "tunnel-broker",
        status: "active",
        createdBy: "system",
      })

      const found = await gw.lookupRouteByDomain(
        db,
        "happy-fox-42.tunnel.dx.dev"
      )
      expect(found).not.toBeNull()
      expect(found!.type).toBe("tunnel")
      expect(found!.domain).toBe("happy-fox-42.tunnel.dx.dev")
    })

    it("returns null for non-existent domain", async () => {
      const found = await gw.lookupRouteByDomain(db, "nope.tunnel.dx.dev")
      expect(found).toBeNull()
    })

    it("returns null for inactive routes", async () => {
      await gw.createRoute(db, {
        type: "tunnel",
        domain: "stale.tunnel.dx.dev",
        targetService: "tunnel-broker",
        status: "expired",
        createdBy: "system",
      })

      const found = await gw.lookupRouteByDomain(db, "stale.tunnel.dx.dev")
      expect(found).toBeNull()
    })
  })

  async function ensurePrincipal(id = "user_1") {
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

  async function createTestSite() {
    const [s] = await db
      .insert(site)
      .values({
        name: "test-site",
        slug: `test-site-${Date.now()}`,
        type: "production",
        spec: {
          status: "provisioning",
          product: "test-product",
        } satisfies SiteSpec,
      })
      .returning()
    return s
  }

  describe("Preview Service", () => {
    beforeEach(async () => {
      await ensurePrincipal("user_1")
    })

    describe("createPreview", () => {
      it("creates preview with route", async () => {
        const s = await createTestSite()
        const result = await previewSvc.createPreview(db, {
          name: "PR #42 - fix-auth-bug",
          sourceBranch: "fix-auth-bug",
          commitSha: "a13f000000000000000000000000000000000000",
          repo: "github.com/org/myapp",
          prNumber: 42,
          siteName: "myapp",
          siteId: s.id,
          ownerId: "user_1",
          createdBy: "system",
        })

        expect(result.preview.id).toBeTruthy()
        expect(result.preview.spec.slug ?? result.preview.slug).toBe(
          "pr-42--fix-auth-bug--myapp"
        )
        expect(result.preview.phase).toBe("building")
        expect(result.route.domain).toBe(
          "pr-42--fix-auth-bug--myapp.preview.dx.dev"
        )
      })

      it("creates branch-only preview (no PR number)", async () => {
        const s = await createTestSite()
        const result = await previewSvc.createPreview(db, {
          name: "feat-dashboard",
          sourceBranch: "feat-dashboard",
          commitSha: "b24f000000000000000000000000000000000000",
          repo: "github.com/org/myapp",
          siteName: "myapp",
          siteId: s.id,
          ownerId: "user_1",
          createdBy: "system",
        })

        expect(result.preview.spec.slug ?? result.preview.slug).toBe(
          "feat-dashboard--myapp"
        )
        expect(result.preview.prNumber).toBeNull()
      })
    })

    describe("getPreview", () => {
      it("returns preview by id", async () => {
        const s = await createTestSite()
        const { preview: p } = await previewSvc.createPreview(db, {
          name: "PR #1",
          sourceBranch: "main",
          commitSha: "abc",
          repo: "github.com/org/app",
          prNumber: 1,
          siteName: "app",
          siteId: s.id,
          ownerId: "user_1",
          createdBy: "system",
        })

        const found = await previewSvc.getPreview(db, p.id)
        expect(found).not.toBeNull()
        expect(found!.id).toBe(p.id)
      })

      it("returns null for non-existent id", async () => {
        const found = await previewSvc.getPreview(db, "prev_nonexistent")
        expect(found).toBeNull()
      })
    })

    describe("updatePreviewStatus", () => {
      it("transitions preview to active", async () => {
        const s = await createTestSite()
        const { preview: p } = await previewSvc.createPreview(db, {
          name: "PR #5",
          sourceBranch: "fix",
          commitSha: "def",
          repo: "github.com/org/app",
          prNumber: 5,
          siteName: "app",
          siteId: s.id,
          ownerId: "user_1",
          createdBy: "system",
        })

        const updated = await previewSvc.updatePreviewStatus(db, p.id, {
          status: "active",
          runtimeClass: "hot",
        })
        expect(updated!.phase).toBe("active")
        expect(updated!.spec.runtimeClass).toBe("hot")
      })
    })

    describe("expirePreview", () => {
      it("marks preview as expired and updates route", async () => {
        const s = await createTestSite()
        const { preview: p } = await previewSvc.createPreview(db, {
          name: "PR #10",
          sourceBranch: "old",
          commitSha: "ghi",
          repo: "github.com/org/app",
          prNumber: 10,
          siteName: "app",
          siteId: s.id,
          ownerId: "user_1",
          createdBy: "system",
        })

        await previewSvc.updatePreviewStatus(db, p.id, { status: "active" })
        await previewSvc.expirePreview(db, p.id)

        const expired = await previewSvc.getPreview(db, p.id)
        expect(expired!.phase).toBe("expired")
      })
    })

    describe("runPreviewCleanup", () => {
      it("marks expired previews based on expiresAt", async () => {
        const s = await createTestSite()
        const { preview: p } = await previewSvc.createPreview(db, {
          name: "PR #20",
          sourceBranch: "old-branch",
          commitSha: "xyz",
          repo: "github.com/org/app",
          prNumber: 20,
          siteName: "app",
          siteId: s.id,
          ownerId: "user_1",
          createdBy: "system",
          expiresAt: new Date(Date.now() - 60_000),
        })
        await previewSvc.updatePreviewStatus(db, p.id, { status: "active" })
        // Set expiresAt in spec
        await db
          .update(preview)
          .set({
            spec: {
              ...p.spec,
              expiresAt: new Date(Date.now() - 60_000).toISOString(),
            } satisfies PreviewSpec,
          })
          .where(eq(preview.id, p.id))

        const result = await previewSvc.runPreviewCleanup(db)
        expect(result.expired).toBeGreaterThanOrEqual(1)

        const updated = await previewSvc.getPreview(db, p.id)
        expect(updated!.phase).toBe("expired")
      })

      it("transitions hot previews to warm after idle period", async () => {
        const s = await createTestSite()
        const { preview: p } = await previewSvc.createPreview(db, {
          name: "PR #21",
          sourceBranch: "idle-branch",
          commitSha: "abc",
          repo: "github.com/org/app",
          prNumber: 21,
          siteName: "app",
          siteId: s.id,
          ownerId: "user_1",
          createdBy: "system",
        })
        await previewSvc.updatePreviewStatus(db, p.id, {
          status: "active",
          runtimeClass: "hot",
          lastAccessedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        })

        const result = await previewSvc.runPreviewCleanup(db)
        expect(result.scaledToWarm).toBeGreaterThanOrEqual(1)

        const updated = await previewSvc.getPreview(db, p.id)
        expect(updated!.spec.runtimeClass).toBe("warm")
      })
    })
  })

  describe("Full Gateway Flow", () => {
    it("creates preview → resolves via gateway lookup → transitions to active", async () => {
      await ensurePrincipal("user_1")
      const s = await createTestSite()
      // 1. Create preview
      const { preview: p, route: r } = await previewSvc.createPreview(db, {
        name: "PR #99 - e2e-test",
        sourceBranch: "e2e-test",
        commitSha: "e2e000",
        repo: "github.com/org/app",
        prNumber: 99,
        siteName: "app",
        siteId: s.id,
        ownerId: "user_1",
        createdBy: "system",
      })

      expect(r.domain).toBe("pr-99--e2e-test--app.preview.dx.dev")

      // 2. Route should be resolvable
      const found = await gw.lookupRouteByDomain(
        db,
        "pr-99--e2e-test--app.preview.dx.dev"
      )
      expect(found).not.toBeNull()
      expect(found!.type).toBe("preview")

      // 3. Transition to active
      await previewSvc.updatePreviewStatus(db, p.id, {
        status: "active",
        runtimeClass: "hot",
        lastAccessedAt: new Date(),
      })

      const active = await previewSvc.getPreview(db, p.id)
      expect(active!.phase).toBe("active")
      expect(active!.spec.runtimeClass).toBe("hot")
    })
  })
})
