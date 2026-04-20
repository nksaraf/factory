import type { PGlite } from "@electric-sql/pglite"
import type {
  SiteObservedStatus,
  SiteSpec,
  SystemDeploymentObservedStatus,
  SystemDeploymentSpec,
} from "@smp/factory-shared/schemas/ops"
import type { SystemSpec } from "@smp/factory-shared/schemas/software"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"

import type { Database } from "../db/connection"
import { site, systemDeployment } from "../db/schema/ops"
import { system } from "../db/schema/software"
import { createTestContext, truncateAllTables } from "../test-helpers"
import type { GitHostService } from "../modules/build/git-host.service"
import { WebhookService } from "../modules/build/webhook.service"

describe("Webhook PR flows", () => {
  let db: Database
  let client: PGlite
  let webhookService: WebhookService

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

  async function createParentSite(
    name = "parent-site",
    overrides?: Partial<SiteSpec>
  ) {
    const spec: SiteSpec = {
      product: "smp",
      updatePolicy: "auto",
      lifecycle: "persistent",
      previewConfig: {
        enabled: true,
        defaultAuthMode: "team",
        ttlDays: 7,
      },
      ...overrides,
    }
    const [s] = await db
      .insert(site)
      .values({
        name,
        slug: name,
        type: "production",
        spec,
        status: { phase: "active" } satisfies SiteObservedStatus,
      } as typeof site.$inferInsert)
      .returning()
    return s
  }

  function makePrPayload(overrides?: {
    number?: number
    title?: string
    branch?: string
    sha?: string
    repo?: string
    sender?: string
  }) {
    return {
      pull_request: {
        number: overrides?.number ?? 42,
        title: overrides?.title ?? "Test PR",
        head: {
          ref: overrides?.branch ?? "feature/test",
          sha: overrides?.sha ?? "abc123def456",
        },
      },
      repository: { full_name: overrides?.repo ?? "org/repo" },
      sender: { login: overrides?.sender ?? "testuser" },
    }
  }

  beforeAll(async () => {
    const ctx = await createTestContext()
    db = ctx.db as unknown as Database
    client = ctx.client

    const mockGitHostService = {} as GitHostService
    webhookService = new WebhookService(db, mockGitHostService)
  })

  afterAll(async () => {
    await client.close()
  })

  beforeEach(async () => {
    await truncateAllTables(client)
  })

  describe("opened action", () => {
    it("creates a preview site with trigger metadata when PR is opened", async () => {
      const parentSite = await createParentSite()
      const sys = await createSystem()
      const payload = makePrPayload()

      await webhookService["handlePullRequestEvent"]("opened", payload)

      const sites = await db.select().from(site).where(eq(site.type, "preview"))
      expect(sites).toHaveLength(1)

      const previewSite = sites[0]
      expect(previewSite.name).toBe("PR #42: Test PR")
      expect(previewSite.slug).toContain("preview-pr-42")
      const siteSpec = previewSite.spec as SiteSpec
      expect(siteSpec.trigger?.type).toBe("pull_request")
      expect(siteSpec.trigger?.prNumber).toBe(42)
      expect(siteSpec.trigger?.commitSha).toBe("abc123def456")
      expect(siteSpec.trigger?.branch).toBe("feature/test")
      expect(siteSpec.trigger?.createdBy).toBe("testuser")
      expect(siteSpec.lifecycle).toBe("ephemeral")
      // parentSiteId comes from whichever site findPreviewParentSite picks
      expect(previewSite.parentSiteId).toBeTruthy()

      expect(previewSite.status?.phase).toBe("pending_image")
    })

    it("creates a system deployment for the preview site", async () => {
      await createParentSite()
      const sys = await createSystem()
      const payload = makePrPayload()

      await webhookService["handlePullRequestEvent"]("opened", payload)

      const sds = await db.select().from(systemDeployment)
      expect(sds).toHaveLength(1)

      const sd = sds[0]
      expect(sd.type).toBe("preview")
      expect(sd.systemId).toBe(sys.id)
      expect(sd.status?.phase).toBe("provisioning")
    })

    it("skips preview creation when no site has previews enabled", async () => {
      // Disable preview config on the seeded default site
      await db
        .update(site)
        .set({
          spec: {
            updatePolicy: "auto",
            lifecycle: "persistent",
          } satisfies SiteSpec,
        })
        .where(eq(site.slug, "default"))

      await createSystem()
      const payload = makePrPayload()

      await webhookService["handlePullRequestEvent"]("opened", payload)

      const sites = await db.select().from(site).where(eq(site.type, "preview"))
      expect(sites).toHaveLength(0)
    })

    it("resets existing preview site on reopened action", async () => {
      await createParentSite()
      await createSystem()
      const payload = makePrPayload({ sha: "first-sha" })

      await webhookService["handlePullRequestEvent"]("opened", payload)

      const [previewSite] = await db
        .select()
        .from(site)
        .where(eq(site.type, "preview"))

      // Mark it decommissioned (simulating a closed PR)
      await db
        .update(site)
        .set({ status: { phase: "decommissioned" } })
        .where(eq(site.id, previewSite.id))

      // Reopen with a new sha
      const reopenPayload = makePrPayload({ sha: "new-sha" })
      await webhookService["handlePullRequestEvent"]("reopened", reopenPayload)

      // Should not create a second preview site
      const previewSites = await db
        .select()
        .from(site)
        .where(eq(site.type, "preview"))
      expect(previewSites).toHaveLength(1)

      const updated = previewSites[0]
      const spec = updated.spec as SiteSpec
      expect(spec.trigger?.commitSha).toBe("new-sha")
      expect(updated.status?.phase).toBe("pending_image")
    })
  })

  describe("synchronize action", () => {
    it("updates the existing preview site commit sha", async () => {
      await createParentSite()
      await createSystem()
      const payload = makePrPayload({ sha: "initial-sha" })

      await webhookService["handlePullRequestEvent"]("opened", payload)

      const syncPayload = makePrPayload({ sha: "updated-sha" })
      await webhookService["handlePullRequestEvent"]("synchronize", syncPayload)

      const [previewSite] = await db
        .select()
        .from(site)
        .where(eq(site.type, "preview"))
      const spec = previewSite.spec as SiteSpec
      expect(spec.trigger?.commitSha).toBe("updated-sha")
      expect(previewSite.status?.phase).toBe("pending_image")
    })

    it("creates a new preview site if none exists for the PR", async () => {
      await createParentSite()
      await createSystem()
      const payload = makePrPayload({ sha: "new-sha" })

      await webhookService["handlePullRequestEvent"]("synchronize", payload)

      const sites = await db.select().from(site).where(eq(site.type, "preview"))
      expect(sites).toHaveLength(1)

      const spec = sites[0].spec as SiteSpec
      expect(spec.trigger?.commitSha).toBe("new-sha")
    })
  })

  describe("closed action", () => {
    it("decommissions the preview site and marks SDs as destroying", async () => {
      await createParentSite()
      await createSystem()
      const payload = makePrPayload()

      await webhookService["handlePullRequestEvent"]("opened", payload)

      const [previewSite] = await db
        .select()
        .from(site)
        .where(eq(site.type, "preview"))
      expect(previewSite).toBeTruthy()

      await webhookService["handlePullRequestEvent"]("closed", payload)

      const [updatedSite] = await db
        .select()
        .from(site)
        .where(eq(site.id, previewSite.id))
      expect(updatedSite.status?.phase).toBe("decommissioned")

      const sds = await db
        .select()
        .from(systemDeployment)
        .where(eq(systemDeployment.siteId, previewSite.id))
      expect(sds).toHaveLength(1)
      expect(sds[0].status?.phase).toBe("destroying")
    })

    it("is a no-op when no preview site exists for the PR", async () => {
      const payload = makePrPayload({ number: 999 })

      await webhookService["handlePullRequestEvent"]("closed", payload)

      const sites = await db.select().from(site).where(eq(site.type, "preview"))
      expect(sites).toHaveLength(0)
    })
  })
})
