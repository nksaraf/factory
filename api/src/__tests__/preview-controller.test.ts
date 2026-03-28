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
  return new Request(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function del(url: string) {
  return new Request(url, { method: "DELETE" });
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
    it("POST /previews creates preview with 3-layer structure", async () => {
      const res = await createPreview();
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.preview).toBeTruthy();
      expect(data.preview.previewId).toBeTruthy();
      expect(data.preview.slug).toBe("pr-42--feat-auth-fix--default");
      expect(data.preview.status).toBe("building");
      expect(data.preview.runtimeClass).toBe("hot");
      expect(data.deploymentTarget).toBeTruthy();
      expect(data.deploymentTarget.kind).toBe("preview");
      expect(data.route).toBeTruthy();
      expect(data.route.domain).toBe("pr-42--feat-auth-fix--default.preview.dx.dev");
      expect(data.route.status).toBe("active");
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
        new Request(`${BASE}?status=building`)
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
    it("PATCH /previews/:slug/status updates preview status", async () => {
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

    it("PATCH /previews/:slug/status returns 404 for nonexistent", async () => {
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

    it("DELETE /previews/:slug expires and returns previewId", async () => {
      const createRes = await createPreview();
      const { data: created } = (await createRes.json()) as any;

      const res = await app.handle(
        del(`${BASE}/pr-42--feat-auth-fix--default`)
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.previewId).toBe(created.preview.previewId);
    });

    it("DELETE /previews/:slug returns 404 for nonexistent", async () => {
      const res = await app.handle(del(`${BASE}/nonexistent`));
      expect(res.status).toBe(404);
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
