import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, truncateAllTables } from "../test-helpers";
import * as gw from "../modules/infra/gateway.service";
import * as previewSvc from "../services/preview/preview.service";
import type { Database } from "../db/connection";
import type { PGlite } from "@electric-sql/pglite";
import { preview } from "../db/schema/fleet";
import { eq } from "drizzle-orm";

describe("Gateway Services", () => {
  let db: Database;
  let client: PGlite;

  beforeAll(async () => {
    const ctx = await createTestContext();
    db = ctx.db as unknown as Database;
    client = ctx.client;
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await truncateAllTables(client);
  });

  describe("lookupRouteByDomain", () => {
    it("finds an active route by domain", async () => {
      await gw.createRoute(db, {
        kind: "tunnel",
        domain: "happy-fox-42.tunnel.dx.dev",
        targetService: "tunnel-broker",
        status: "active",
        createdBy: "system",
      });

      const found = await gw.lookupRouteByDomain(db, "happy-fox-42.tunnel.dx.dev");
      expect(found).not.toBeNull();
      expect(found!.kind).toBe("tunnel");
      expect(found!.domain).toBe("happy-fox-42.tunnel.dx.dev");
    });

    it("returns null for non-existent domain", async () => {
      const found = await gw.lookupRouteByDomain(db, "nope.tunnel.dx.dev");
      expect(found).toBeNull();
    });

    it("returns null for inactive routes", async () => {
      await gw.createRoute(db, {
        kind: "tunnel",
        domain: "stale.tunnel.dx.dev",
        targetService: "tunnel-broker",
        status: "expired",
        createdBy: "system",
      });

      const found = await gw.lookupRouteByDomain(db, "stale.tunnel.dx.dev");
      expect(found).toBeNull();
    });
  });

  describe("Preview Service", () => {
    describe("createPreview", () => {
      it("creates preview with deploymentTarget and route", async () => {
        const result = await previewSvc.createPreview(db, {
          name: "PR #42 - fix-auth-bug",
          sourceBranch: "fix-auth-bug",
          commitSha: "a13f000000000000000000000000000000000000",
          repo: "github.com/org/myapp",
          prNumber: 42,
          siteName: "myapp",
          ownerId: "user_1",
          createdBy: "system",
        });

        expect(result.preview.previewId).toBeTruthy();
        expect(result.preview.slug).toBe("pr-42--fix-auth-bug--myapp");
        expect(result.preview.status).toBe("building");
        expect(result.deploymentTarget.kind).toBe("preview");
        expect(result.route.domain).toBe("pr-42--fix-auth-bug--myapp.preview.dx.dev");
      });

      it("creates branch-only preview (no PR number)", async () => {
        const result = await previewSvc.createPreview(db, {
          name: "feat-dashboard",
          sourceBranch: "feat-dashboard",
          commitSha: "b24f000000000000000000000000000000000000",
          repo: "github.com/org/myapp",
          siteName: "myapp",
          ownerId: "user_1",
          createdBy: "system",
        });

        expect(result.preview.slug).toBe("feat-dashboard--myapp");
        expect(result.preview.prNumber).toBeNull();
      });
    });

    describe("getPreview", () => {
      it("returns preview by id", async () => {
        const { preview } = await previewSvc.createPreview(db, {
          name: "PR #1",
          sourceBranch: "main",
          commitSha: "abc",
          repo: "github.com/org/app",
          prNumber: 1,
          siteName: "app",
          ownerId: "user_1",
          createdBy: "system",
        });

        const found = await previewSvc.getPreview(db, preview.previewId);
        expect(found).not.toBeNull();
        expect(found!.previewId).toBe(preview.previewId);
      });

      it("returns null for non-existent id", async () => {
        const found = await previewSvc.getPreview(db, "prev_nonexistent");
        expect(found).toBeNull();
      });
    });

    describe("updatePreviewStatus", () => {
      it("transitions preview to active", async () => {
        const { preview } = await previewSvc.createPreview(db, {
          name: "PR #5",
          sourceBranch: "fix",
          commitSha: "def",
          repo: "github.com/org/app",
          prNumber: 5,
          siteName: "app",
          ownerId: "user_1",
          createdBy: "system",
        });

        const updated = await previewSvc.updatePreviewStatus(db, preview.previewId, {
          status: "active",
          runtimeClass: "hot",
        });
        expect(updated!.status).toBe("active");
        expect(updated!.runtimeClass).toBe("hot");
      });
    });

    describe("expirePreview", () => {
      it("marks preview as expired and updates route", async () => {
        const { preview } = await previewSvc.createPreview(db, {
          name: "PR #10",
          sourceBranch: "old",
          commitSha: "ghi",
          repo: "github.com/org/app",
          prNumber: 10,
          siteName: "app",
          ownerId: "user_1",
          createdBy: "system",
        });

        await previewSvc.updatePreviewStatus(db, preview.previewId, { status: "active" });
        await previewSvc.expirePreview(db, preview.previewId);

        const expired = await previewSvc.getPreview(db, preview.previewId);
        expect(expired!.status).toBe("expired");
      });
    });

    describe("runPreviewCleanup", () => {
      it("marks expired previews based on expiresAt", async () => {
        const { preview: p } = await previewSvc.createPreview(db, {
          name: "PR #20",
          sourceBranch: "old-branch",
          commitSha: "xyz",
          repo: "github.com/org/app",
          prNumber: 20,
          siteName: "app",
          ownerId: "user_1",
          createdBy: "system",
          expiresAt: new Date(Date.now() - 60_000),
        });
        await previewSvc.updatePreviewStatus(db, p.previewId, { status: "active" });
        await db.update(preview).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(preview.previewId, p.previewId));

        const result = await previewSvc.runPreviewCleanup(db);
        expect(result.expired).toBeGreaterThanOrEqual(1);

        const updated = await previewSvc.getPreview(db, p.previewId);
        expect(updated!.status).toBe("expired");
      });

      it("transitions hot previews to warm after idle period", async () => {
        const { preview: p } = await previewSvc.createPreview(db, {
          name: "PR #21",
          sourceBranch: "idle-branch",
          commitSha: "abc",
          repo: "github.com/org/app",
          prNumber: 21,
          siteName: "app",
          ownerId: "user_1",
          createdBy: "system",
        });
        await previewSvc.updatePreviewStatus(db, p.previewId, {
          status: "active",
          runtimeClass: "hot",
          lastAccessedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        });

        const result = await previewSvc.runPreviewCleanup(db);
        expect(result.scaledToWarm).toBeGreaterThanOrEqual(1);

        const updated = await previewSvc.getPreview(db, p.previewId);
        expect(updated!.runtimeClass).toBe("warm");
      });
    });
  });
});
