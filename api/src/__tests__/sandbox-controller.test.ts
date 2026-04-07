/**
 * Workspace Controller Tests (was sandbox-controller.test.ts)
 *
 * v2: sandboxes → workspaces, endpoint moved from /infra/sandboxes → /fleet/workspaces
 * v2: sandboxId → id, status/lifecycle in spec JSONB
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  truncateAllTables,
  type TestApp,
} from "../test-helpers";
import type { PGlite } from "@electric-sql/pglite";

interface ApiResponse<T = Record<string, unknown>> { data: T }
interface ApiListResponse<T = Record<string, unknown>> { data: T[] }

const BASE = "http://localhost/api/v1/factory/fleet/workspaces";

function post(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function del(url: string) {
  return new Request(`${url}/delete`, { method: "POST" });
}

describe("Workspace Controller (v2 — was Sandbox Controller)", () => {
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

  // Helper to create a workspace via the API
  async function createWorkspace(overrides?: Record<string, unknown>) {
    const ts = Date.now();
    const res = await app.handle(
      post(`${BASE}`, {
        slug: `test-workspace-${ts}`,
        name: "test-workspace",
        type: "developer",
        ownerId: "user_1",
        spec: {},
        ...overrides,
      })
    );
    return res;
  }

  // =========================================================================
  // Workspace CRUD (was Sandbox CRUD)
  // =========================================================================
  describe("Workspace CRUD", () => {
    it("POST /workspaces creates workspace and returns id", async () => {
      const res = await createWorkspace();
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as ApiResponse;
      expect(data.id).toBeTruthy();
      expect(data.name).toBe("test-workspace");
    });

    it("GET /workspaces lists workspaces", async () => {
      await createWorkspace({ slug: "wks-1", name: "wks-1" });
      await createWorkspace({ slug: "wks-2", name: "wks-2" });

      const res = await app.handle(new Request(`${BASE}`));
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as ApiListResponse;
      expect(data).toHaveLength(2);
    });

    it("GET /workspaces/:id returns detail", async () => {
      const createRes = await createWorkspace();
      const { data: created } = (await createRes.json()) as ApiResponse;

      const res = await app.handle(
        new Request(`${BASE}/${created.id}`)
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as ApiResponse<{ id: string; spec: { lifecycle: string } }>;
      expect(data.id).toBe(created.id);
      // provisioning lifecycle is set in beforeCreate hook
      expect(data.spec.lifecycle).toBe("provisioning");
    });

    it("GET /workspaces/:id returns 404 for nonexistent", async () => {
      const res = await app.handle(
        new Request(`${BASE}/wks_nonexistent`)
      );
      expect(res.status).toBe(404);
    });

    it("POST /workspaces/:id/delete marks workspace as deleted (bitemporal)", async () => {
      const createRes = await createWorkspace();
      const { data: created } = (await createRes.json()) as ApiResponse;

      const res = await app.handle(
        del(`${BASE}/${created.id}`)
      );
      expect(res.status).toBe(200);

      // Verify not returned in list (bitemporal delete sets validTo)
      const listRes = await app.handle(new Request(`${BASE}`));
      const { data } = (await listRes.json()) as ApiListResponse;
      expect(data).toHaveLength(0);
    });

    it("POST /workspaces/:id/delete returns 404 for nonexistent", async () => {
      const res = await app.handle(
        del(`${BASE}/wks_nonexistent`)
      );
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // Lifecycle
  // =========================================================================
  describe("Lifecycle", () => {
    it("POST /workspaces/:id/start sets lifecycle to active", async () => {
      const createRes = await createWorkspace();
      const { data: created } = (await createRes.json()) as ApiResponse;

      const res = await app.handle(
        post(`${BASE}/${created.id}/start`, {})
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as ApiResponse<{ spec: { lifecycle: string } }>;
      expect(data.spec.lifecycle).toBe("active");
    });

    it("POST /workspaces/:id/stop sets lifecycle to suspended", async () => {
      const createRes = await createWorkspace();
      const { data: created } = (await createRes.json()) as ApiResponse;

      await app.handle(post(`${BASE}/${created.id}/start`, {}));

      const res = await app.handle(
        post(`${BASE}/${created.id}/stop`, {})
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as ApiResponse<{ spec: { lifecycle: string } }>;
      expect(data.spec.lifecycle).toBe("suspended");
    });

    it("POST /workspaces/:id/resize updates cpu/memory/storageGb in spec", async () => {
      const createRes = await createWorkspace();
      const { data: created } = (await createRes.json()) as ApiResponse;

      const res = await app.handle(
        post(`${BASE}/${created.id}/resize`, {
          cpu: "4000m",
          memory: "8Gi",
          storageGb: 50,
        })
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as ApiResponse<{ spec: { cpu: string; memory: string; storageGb: number } }>;
      expect(data.spec.cpu).toBe("4000m");
      expect(data.spec.memory).toBe("8Gi");
      expect(data.spec.storageGb).toBe(50);
    });

    it("POST /workspaces/:id/extend updates expiresAt in spec", async () => {
      const createRes = await createWorkspace();
      const { data: created } = (await createRes.json()) as ApiResponse;

      const res = await app.handle(
        post(`${BASE}/${created.id}/extend`, {
          minutes: 120,
        })
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as ApiResponse<{ spec: { expiresAt: string } }>;
      expect(data.spec.expiresAt).toBeTruthy();
    });

    it("POST /workspaces/:id/start returns 404 for nonexistent", async () => {
      const res = await app.handle(
        post(`${BASE}/wks_nonexistent/start`, {})
      );
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // Snapshots
  // =========================================================================
  describe("Snapshots", () => {
    it("POST /workspaces/:id/snapshot creates snapshot", async () => {
      const createRes = await createWorkspace();
      const { data: created } = (await createRes.json()) as ApiResponse;

      const res = await app.handle(
        post(`${BASE}/${created.id}/snapshot`, {
          name: "my-snapshot",
          description: "A test snapshot",
        })
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as ApiResponse<{ id: string; spec: { status: string } }>;
      expect(data.id).toBeTruthy();
      expect(data.spec.status).toBe("creating");
    });

    it("GET /workspaces/:id/snapshots lists snapshots", async () => {
      const createRes = await createWorkspace();
      const { data: created } = (await createRes.json()) as ApiResponse;

      await app.handle(
        post(`${BASE}/${created.id}/snapshot`, { name: "snap-1" })
      );
      await app.handle(
        post(`${BASE}/${created.id}/snapshot`, { name: "snap-2" })
      );

      const res = await app.handle(
        new Request(`${BASE}/${created.id}/snapshots`)
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as ApiListResponse;
      expect(data).toHaveLength(2);
    });
  });
});
