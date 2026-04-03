import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  truncateAllTables,
  type TestApp,
} from "../test-helpers";
import type { PGlite } from "@electric-sql/pglite";

const BASE = "http://localhost/api/v1/factory/infra/previews";

function post(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patch(url: string, body: Record<string, unknown>) {
  return new Request(`${url}/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function del(url: string) {
  return new Request(`${url}/delete`, { method: "POST" });
}

describe("Preview Controller", () => {
  let app: TestApp;
  let client: PGlite;

  beforeAll(async () => {
    const ctx = await createTestContext();
    app = ctx.app;
    client = ctx.client;
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await truncateAllTables(client);
  });

  async function createPreview(overrides?: Record<string, unknown>) {
    const res = await app.handle(
      post(BASE, {
        name: "Test Preview",
        sourceBranch: "feat/auth-fix",
        commitSha: "abc123def456",
        repo: "myorg/myrepo",
        prNumber: 42,
        siteName: "default",
        ownerId: "user_1",
        createdBy: "user_1",
        ...overrides,
      })
    );
    return res;
  }

  // =========================================================================
  // Preview CRUD
  // =========================================================================
  describe("Preview CRUD", () => {
    it("POST /previews creates preview in pending_image status", async () => {
      const res = await createPreview();
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.preview).toBeTruthy();
      expect(data.preview.previewId).toBeTruthy();
      expect(data.preview.slug).toBe("pr-42--feat-auth-fix--default");
      expect(data.preview.status).toBe("pending_image");
      expect(data.preview.runtimeClass).toBe("hot");
      expect(data.deploymentTarget).toBeTruthy();
      expect(data.deploymentTarget.kind).toBe("preview");
      expect(data.route).toBeTruthy();
      expect(data.route.domain).toBe("pr-42--feat-auth-fix--default.preview.dx.dev");
      expect(data.route.status).toBe("active");
    });

    it("POST /previews with imageRef creates preview in deploying status", async () => {
      const res = await createPreview({ imageRef: "ghcr.io/myorg/myapp:pr-42" });
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.preview.status).toBe("deploying");
      expect(data.preview.imageRef).toBe("ghcr.io/myorg/myapp:pr-42");
    });

    it("GET /previews lists previews", async () => {
      await createPreview({ prNumber: 1, sourceBranch: "branch-a" });
      await createPreview({ prNumber: 2, sourceBranch: "branch-b" });

      const res = await app.handle(new Request(BASE));
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data).toHaveLength(2);
    });

    it("GET /previews filters by status", async () => {
      await createPreview({ prNumber: 1, sourceBranch: "branch-a" });
      await createPreview({ prNumber: 2, sourceBranch: "branch-b" });

      const res = await app.handle(
        new Request(`${BASE}?status=pending_image`)
      );
      const { data } = (await res.json()) as any;
      expect(data).toHaveLength(2);
    });

    it("GET /previews filters by repo", async () => {
      await createPreview({ prNumber: 1, sourceBranch: "branch-a", repo: "org/repo-a" });
      await createPreview({ prNumber: 2, sourceBranch: "branch-b", repo: "org/repo-b" });

      const res = await app.handle(
        new Request(`${BASE}?repo=org/repo-a`)
      );
      const { data } = (await res.json()) as any;
      expect(data).toHaveLength(1);
      expect(data[0].repo).toBe("org/repo-a");
    });

    it("GET /previews/:slug returns preview by slug", async () => {
      await createPreview();

      const res = await app.handle(
        new Request(`${BASE}/pr-42--feat-auth-fix--default`)
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.slug).toBe("pr-42--feat-auth-fix--default");
      expect(data.prNumber).toBe(42);
      expect(data.sourceBranch).toBe("feat/auth-fix");
    });

    it("GET /previews/:slug returns 404 for nonexistent slug", async () => {
      const res = await app.handle(
        new Request(`${BASE}/nonexistent-slug`)
      );
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // Status Updates
  // =========================================================================
  describe("Status Updates", () => {
    it("POST /previews/:slug/status/update updates preview status", async () => {
      await createPreview();

      const res = await app.handle(
        patch(`${BASE}/pr-42--feat-auth-fix--default/status`, {
          status: "active",
          runtimeClass: "hot",
        })
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.status).toBe("active");
      expect(data.runtimeClass).toBe("hot");
    });

    it("POST /previews/:slug/status/update returns 404 for nonexistent", async () => {
      const res = await app.handle(
        patch(`${BASE}/nonexistent/status`, { status: "active" })
      );
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // Expire & Delete
  // =========================================================================
  describe("Expire & Delete", () => {
    it("POST /previews/:slug/expire expires a preview", async () => {
      await createPreview();

      const res = await app.handle(
        post(`${BASE}/pr-42--feat-auth-fix--default/expire`, {})
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.status).toBe("expired");
    });

    it("POST /previews/:slug/delete expires and returns previewId", async () => {
      const createRes = await createPreview();
      const { data: created } = (await createRes.json()) as any;

      const res = await app.handle(
        del(`${BASE}/pr-42--feat-auth-fix--default`)
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.previewId).toBe(created.preview.previewId);
    });

    it("POST /previews/:slug/delete returns 404 for nonexistent", async () => {
      const res = await app.handle(del(`${BASE}/nonexistent`));
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // Image Delivery
  // =========================================================================
  describe("Image Delivery", () => {
    it("POST /previews/:slug/image transitions pending_image → deploying", async () => {
      await createPreview();
      const slug = "pr-42--feat-auth-fix--default";

      const res = await app.handle(
        post(`${BASE}/${slug}/image`, { imageRef: "ghcr.io/myorg/app:pr-42" })
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.status).toBe("deploying");
      expect(data.imageRef).toBe("ghcr.io/myorg/app:pr-42");
    });

    it("POST /previews/:slug/image rejects if already active", async () => {
      await createPreview();
      const slug = "pr-42--feat-auth-fix--default";

      // First, set it to active
      await app.handle(
        patch(`${BASE}/${slug}/status`, { status: "active" })
      );

      const res = await app.handle(
        post(`${BASE}/${slug}/image`, { imageRef: "ghcr.io/myorg/app:v2" })
      );
      expect(res.status).toBe(409);
      const body = (await res.json()) as any;
      expect(body.error).toBe("invalid_status");
    });

    it("POST /previews/:slug/image returns 404 for nonexistent", async () => {
      const res = await app.handle(
        post(`${BASE}/nonexistent/image`, { imageRef: "ghcr.io/myorg/app:v1" })
      );
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // Extend TTL
  // =========================================================================
  describe("Extend TTL", () => {
    it("POST /previews/:slug/extend extends preview expiry", async () => {
      await createPreview();
      const slug = "pr-42--feat-auth-fix--default";

      const res = await app.handle(
        post(`${BASE}/${slug}/extend`, { days: 14 })
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.expiresAt).toBeTruthy();
    });

    it("POST /previews/:slug/extend rejects expired preview", async () => {
      await createPreview();
      const slug = "pr-42--feat-auth-fix--default";

      // Expire it
      await app.handle(post(`${BASE}/${slug}/expire`, {}));

      const res = await app.handle(
        post(`${BASE}/${slug}/extend`, { days: 7 })
      );
      expect(res.status).toBe(409);
    });
  });

  // =========================================================================
  // Slug Generation
  // =========================================================================
  describe("Slug Generation", () => {
    it("generates slug with PR number", async () => {
      const res = await createPreview({
        prNumber: 99,
        sourceBranch: "feature/new-thing",
        siteName: "myapp",
      });
      const { data } = (await res.json()) as any;
      expect(data.preview.slug).toBe("pr-99--feature-new-thing--myapp");
    });

    it("generates slug without PR number", async () => {
      const res = await createPreview({
        prNumber: undefined,
        sourceBranch: "main",
        siteName: "myapp",
      });
      const { data } = (await res.json()) as any;
      expect(data.preview.slug).toBe("main--myapp");
    });
  });
});
