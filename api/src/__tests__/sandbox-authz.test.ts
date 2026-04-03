import { describe, expect, it, vi, beforeEach } from "vitest";
import { Elysia } from "elysia";
import { sandboxController } from "../modules/infra/sandbox.controller";
import type { FactoryAuthzClient } from "../lib/authz-client";

// ─── Mock Helpers ────────────────────────────────────────────────────────────

/** Creates a mock FactoryAuthzClient where checkPermission can be controlled. */
function createMockAuthzClient(
  defaultAllow = true,
): FactoryAuthzClient & { _calls: Record<string, any[]> } {
  const calls: Record<string, any[]> = {
    checkPermission: [],
    registerResource: [],
    deleteResource: [],
  };

  return {
    _calls: calls,
    checkPermission: vi.fn(async (params) => {
      calls.checkPermission.push(params);
      return defaultAllow;
    }),
    checkPermissionBatch: vi.fn(),
    listAccessible: vi.fn(),
    listSubjects: vi.fn(),
    registerResource: vi.fn(async (params) => {
      calls.registerResource.push(params);
    }),
    deleteResource: vi.fn(async (id) => {
      calls.deleteResource.push(id);
    }),
    updateResourceScopes: vi.fn(),
    registerScopeNode: vi.fn(),
    deleteScopeNode: vi.fn(),
    grantScopeMembership: vi.fn(),
    revokeScopeMembership: vi.fn(),
    addOrgMember: vi.fn(),
    removeOrgMember: vi.fn(),
    grantResourceRole: vi.fn(),
    revokeResourceRole: vi.fn(),
    resolveScope: vi.fn(),
  } as any;
}

/**
 * Mock sandbox service. We mock the entire service module so the controller
 * never touches a real DB.
 */
const mockSandbox = {
  sandboxId: "sbx_test-1",
  slug: "test-sandbox",
  name: "Test Sandbox",
  status: "running",
  healthStatus: "healthy",
  healthCheckedAt: new Date().toISOString(),
};

const mockSnapshot = {
  sandboxSnapshotId: "snap_test-1",
  sandboxId: "sbx_test-1",
  name: "snap-1",
};

vi.mock("../services/sandbox/sandbox.service", () => ({
  createSandbox: vi.fn(async () => mockSandbox),
  getSandbox: vi.fn(async (_db: any, id: string) => {
    if (id === "sbx_test-1" || id === "test-sandbox") return mockSandbox;
    return null;
  }),
  listSandboxes: vi.fn(async () => [mockSandbox]),
  deleteSandbox: vi.fn(async () => {}),
  startSandbox: vi.fn(async () => ({ ...mockSandbox, status: "starting" })),
  stopSandbox: vi.fn(async () => ({ ...mockSandbox, status: "stopping" })),
  resizeSandbox: vi.fn(async () => mockSandbox),
  extendSandbox: vi.fn(async () => mockSandbox),
  listSnapshots: vi.fn(async () => [mockSnapshot]),
  snapshotSandbox: vi.fn(async () => mockSnapshot),
  getSnapshot: vi.fn(async (_db: any, id: string) => {
    if (id === "snap_test-1") return mockSnapshot;
    return null;
  }),
  deleteSnapshot: vi.fn(async () => {}),
  restoreSandbox: vi.fn(async () => mockSandbox),
  cloneSandbox: vi.fn(async () => ({ ...mockSandbox, sandboxId: "sbx_clone-1" })),
}));

vi.mock("../services/sandbox/sandbox-template.service", () => ({
  listTemplates: vi.fn(async () => []),
  getTemplate: vi.fn(async () => null),
  createTemplate: vi.fn(async () => ({})),
  deleteTemplate: vi.fn(async () => {}),
}));

/** Build a minimal Elysia app with sandboxController + fake auth context. */
function buildApp(
  authzClient: FactoryAuthzClient | null,
  opts: { principalId?: string; orgId?: string } = {},
) {
  const { principalId = "user-1", orgId = "org-1" } = opts;

  return new Elysia()
    .derive(() => ({
      principalId,
      user: { id: principalId, organizationId: orgId },
    }))
    .use(sandboxController({} as any, authzClient));
}

async function request(
  app: Elysia,
  method: string,
  path: string,
  body?: any,
) {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) init.body = JSON.stringify(body);

  const resp = await app.handle(
    new Request(`http://localhost/sandboxes${path}`, init),
  );
  const json = await resp.json().catch(() => null);
  return { status: resp.status, body: json };
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe("Sandbox Controller — AuthZ Wiring", () => {
  // ─── Dev Mode (null authzClient) ────────────────────────────────────────

  describe("dev mode (authzClient = null)", () => {
    it("GET /:id succeeds without authz checks", async () => {
      const app = buildApp(null);
      const res = await request(app, "GET", "/sbx_test-1");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("POST /:id/delete succeeds without authz checks", async () => {
      const app = buildApp(null);
      const res = await request(app, "POST", "/sbx_test-1/delete");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("POST /:id/start succeeds without authz checks", async () => {
      const app = buildApp(null);
      const res = await request(app, "POST", "/sbx_test-1/start");
      expect(res.status).toBe(200);
    });
  });

  // ─── Permission Denied (403) ────────────────────────────────────────────

  describe("permission denied → 403", () => {
    let authz: ReturnType<typeof createMockAuthzClient>;
    let app: Elysia;

    beforeEach(() => {
      authz = createMockAuthzClient(false); // deny all
      app = buildApp(authz);
    });

    it("GET /:id returns 403 when read denied", async () => {
      const res = await request(app, "GET", "/sbx_test-1");
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("forbidden");
      expect(authz._calls.checkPermission).toHaveLength(1);
      expect(authz._calls.checkPermission[0]).toMatchObject({
        principal: "user-1",
        action: "read",
        resourceType: "sandbox",
        resourceId: "sbx_test-1",
      });
    });

    it("POST /:id/delete returns 403 when delete denied", async () => {
      const res = await request(app, "POST", "/sbx_test-1/delete");
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("forbidden");
      expect(authz._calls.checkPermission[0].action).toBe("delete");
    });

    it("POST /:id/delete does NOT call deleteSandbox when denied", async () => {
      const { deleteSandbox } = await import(
        "../services/sandbox/sandbox.service"
      );
      (deleteSandbox as any).mockClear();
      await request(app, "POST", "/sbx_test-1/delete");
      expect(deleteSandbox).not.toHaveBeenCalled();
    });

    it("POST /:id/delete does NOT call deleteResource when denied", async () => {
      await request(app, "POST", "/sbx_test-1/delete");
      expect(authz._calls.deleteResource).toHaveLength(0);
    });

    it("POST /:id/start returns 403 when update denied", async () => {
      const res = await request(app, "POST", "/sbx_test-1/start");
      expect(res.status).toBe(403);
      expect(authz._calls.checkPermission[0].action).toBe("update");
    });

    it("POST /:id/stop returns 403 when update denied", async () => {
      const res = await request(app, "POST", "/sbx_test-1/stop");
      expect(res.status).toBe(403);
    });

    it("POST /:id/resize returns 403 when update denied", async () => {
      const res = await request(app, "POST", "/sbx_test-1/resize", {
        cpu: "2",
      });
      expect(res.status).toBe(403);
    });

    it("POST /:id/extend returns 403 when update denied", async () => {
      const res = await request(app, "POST", "/sbx_test-1/extend", {
        additionalMinutes: 60,
      });
      expect(res.status).toBe(403);
    });

    it("GET /:id/health returns 403 when read denied", async () => {
      const res = await request(app, "GET", "/sbx_test-1/health");
      expect(res.status).toBe(403);
    });

    // Snapshot endpoints
    it("GET /:id/snapshots returns 403 when read denied", async () => {
      const res = await request(app, "GET", "/sbx_test-1/snapshots");
      expect(res.status).toBe(403);
    });

    it("POST /:id/snapshots returns 403 when update denied", async () => {
      const res = await request(app, "POST", "/sbx_test-1/snapshots", {
        name: "snap",
      });
      expect(res.status).toBe(403);
    });

    it("GET /snapshots/:id returns 403 when read denied", async () => {
      const res = await request(app, "GET", "/snapshots/snap_test-1");
      expect(res.status).toBe(403);
    });

    it("POST /snapshots/:id/delete returns 403 when delete denied", async () => {
      const res = await request(app, "POST", "/snapshots/snap_test-1/delete");
      expect(res.status).toBe(403);
    });

    it("POST /snapshots/:id/restore returns 403 when update denied", async () => {
      const res = await request(app, "POST", "/snapshots/snap_test-1/restore");
      expect(res.status).toBe(403);
    });

    it("POST /snapshots/:id/clone returns 403 when read denied", async () => {
      const res = await request(app, "POST", "/snapshots/snap_test-1/clone", {
        name: "clone",
        ownerId: "user-2",
        ownerType: "user",
      });
      expect(res.status).toBe(403);
    });
  });

  // ─── Permission Allowed ─────────────────────────────────────────────────

  describe("permission allowed → 200", () => {
    let authz: ReturnType<typeof createMockAuthzClient>;
    let app: Elysia;

    beforeEach(() => {
      authz = createMockAuthzClient(true); // allow all
      app = buildApp(authz);
    });

    it("GET /:id returns 200 when read allowed", async () => {
      const res = await request(app, "GET", "/sbx_test-1");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("POST /:id/delete returns 200 and calls deleteResource", async () => {
      const res = await request(app, "POST", "/sbx_test-1/delete");
      expect(res.status).toBe(200);
      // Should have called deleteResource for lifecycle sync
      expect(authz.deleteResource).toHaveBeenCalledWith("sbx_test-1");
    });

    it("POST /:id/start returns 200 when update allowed", async () => {
      const res = await request(app, "POST", "/sbx_test-1/start");
      expect(res.status).toBe(200);
    });
  });

  // ─── Resource Lifecycle Sync ────────────────────────────────────────────

  describe("resource lifecycle sync", () => {
    it("POST / calls registerResource with correct params", async () => {
      const authz = createMockAuthzClient(true);
      const app = buildApp(authz, { principalId: "user-42", orgId: "org-7" });

      const res = await request(app, "POST", "/", {
        name: "my-sandbox",
        ownerId: "user-42",
        ownerType: "user",
      });
      expect(res.status).toBe(200);

      // registerResource is fire-and-forget, so wait a tick
      await new Promise((r) => setTimeout(r, 10));

      expect(authz.registerResource).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "sbx_test-1",
          resourceTypeId: "sandbox",
          orgId: "org-7",
          createdBy: "user-42",
        }),
      );
    });

    it("POST /:id/delete calls deleteResource after successful deletion", async () => {
      const authz = createMockAuthzClient(true);
      const app = buildApp(authz);

      await request(app, "POST", "/sbx_test-1/delete");

      // deleteResource is fire-and-forget, so wait a tick
      await new Promise((r) => setTimeout(r, 10));

      expect(authz.deleteResource).toHaveBeenCalledWith("sbx_test-1");
    });

    it("POST / still succeeds if registerResource fails", async () => {
      const authz = createMockAuthzClient(true);
      (authz.registerResource as any).mockRejectedValue(
        new Error("auth service down"),
      );
      const app = buildApp(authz);

      const res = await request(app, "POST", "/", {
        name: "my-sandbox",
        ownerId: "user-1",
        ownerType: "user",
      });
      // Fire-and-forget: creation should still succeed
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ─── No Principal → Denied ──────────────────────────────────────────────

  describe("missing principal", () => {
    it("returns 403 when principalId is empty", async () => {
      const authz = createMockAuthzClient(true);
      const app = buildApp(authz, { principalId: "" });

      const res = await request(app, "GET", "/sbx_test-1");
      expect(res.status).toBe(403);
      // checkPermission should NOT have been called (short-circuited)
      expect(authz._calls.checkPermission).toHaveLength(0);
    });
  });

  // ─── 404 Passthrough ───────────────────────────────────────────────────

  describe("404 before authz check", () => {
    it("GET /:id returns 404 for nonexistent sandbox (no authz call)", async () => {
      const authz = createMockAuthzClient(true);
      const app = buildApp(authz);

      const res = await request(app, "GET", "/sbx_nonexistent");
      expect(res.status).toBe(404);
      expect(authz._calls.checkPermission).toHaveLength(0);
    });

    it("POST /:id/delete returns 404 for nonexistent sandbox", async () => {
      const authz = createMockAuthzClient(true);
      const app = buildApp(authz);

      const res = await request(app, "POST", "/sbx_nonexistent/delete");
      expect(res.status).toBe(404);
    });
  });
});
