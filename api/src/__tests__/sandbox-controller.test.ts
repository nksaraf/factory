import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  truncateAllTables,
  type TestApp,
} from "../test-helpers";
import type { PGlite } from "@electric-sql/pglite";

const BASE = "http://localhost/api/v1/factory/infra/sandbox";

function post(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function del(url: string) {
  return new Request(url, { method: "DELETE" });
}

describe("Sandbox Controller", () => {
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

  // Helper to create a sandbox via the API
  async function createSandbox(overrides?: Record<string, unknown>) {
    const res = await app.handle(
      post(`${BASE}/sandboxes`, {
        name: "test-sandbox",
        ownerId: "user_1",
        ownerType: "user",
        ...overrides,
      })
    );
    return res;
  }

  // =========================================================================
  // Sandbox CRUD
  // =========================================================================
  describe("Sandbox CRUD", () => {
    it("POST /sandboxes creates sandbox and returns sandboxId", async () => {
      const res = await createSandbox();
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.sandboxId).toBeTruthy();
      expect(data.name).toBe("test-sandbox");
    });

    it("GET /sandboxes lists sandboxes", async () => {
      await createSandbox({ name: "sbx-1" });
      await createSandbox({ name: "sbx-2" });

      const res = await app.handle(new Request(`${BASE}/sandboxes`));
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data).toHaveLength(2);
    });

    it("GET /sandboxes filters work", async () => {
      await createSandbox({ name: "sbx-a", ownerId: "user_1" });
      await createSandbox({ name: "sbx-b", ownerId: "user_2" });

      const res = await app.handle(
        new Request(`${BASE}/sandboxes?ownerId=user_1`)
      );
      const { data } = (await res.json()) as any;
      expect(data).toHaveLength(1);
      expect(data[0].ownerId).toBe("user_1");
    });

    it("GET /sandboxes/:id returns detail", async () => {
      const createRes = await createSandbox();
      const { data: created } = (await createRes.json()) as any;

      const res = await app.handle(
        new Request(`${BASE}/sandboxes/${created.sandboxId}`)
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.sandboxId).toBe(created.sandboxId);
      expect(data.status).toBe("provisioning");
    });

    it("GET /sandboxes/:id returns 404 for nonexistent", async () => {
      const res = await app.handle(
        new Request(`${BASE}/sandboxes/sbx_nonexistent`)
      );
      expect(res.status).toBe(404);
    });

    it("DELETE /sandboxes/:id sets status to destroying", async () => {
      const createRes = await createSandbox();
      const { data: created } = (await createRes.json()) as any;

      const res = await app.handle(
        del(`${BASE}/sandboxes/${created.sandboxId}`)
      );
      expect(res.status).toBe(200);

      // Verify status changed
      const getRes = await app.handle(
        new Request(`${BASE}/sandboxes/${created.sandboxId}`)
      );
      const { data } = (await getRes.json()) as any;
      expect(data.status).toBe("destroying");
    });

    it("DELETE /sandboxes/:id returns 404 for nonexistent", async () => {
      const res = await app.handle(
        del(`${BASE}/sandboxes/sbx_nonexistent`)
      );
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // Lifecycle
  // =========================================================================
  describe("Lifecycle", () => {
    it("POST /sandboxes/:id/start sets status to active", async () => {
      const createRes = await createSandbox();
      const { data: created } = (await createRes.json()) as any;

      const res = await app.handle(
        post(`${BASE}/sandboxes/${created.sandboxId}/start`, {})
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.status).toBe("active");
    });

    it("POST /sandboxes/:id/stop sets status to suspended", async () => {
      const createRes = await createSandbox();
      const { data: created } = (await createRes.json()) as any;

      await app.handle(
        post(`${BASE}/sandboxes/${created.sandboxId}/start`, {})
      );

      const res = await app.handle(
        post(`${BASE}/sandboxes/${created.sandboxId}/stop`, {})
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.status).toBe("suspended");
    });

    it("POST /sandboxes/:id/resize updates resources", async () => {
      const createRes = await createSandbox({
        cpu: "1000m",
        memory: "2Gi",
      });
      const { data: created } = (await createRes.json()) as any;

      const res = await app.handle(
        post(`${BASE}/sandboxes/${created.sandboxId}/resize`, {
          cpu: "4000m",
          memory: "8Gi",
          storageGb: 50,
        })
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.cpu).toBe("4000m");
      expect(data.memory).toBe("8Gi");
      expect(data.storageGb).toBe(50);
    });

    it("POST /sandboxes/:id/extend updates expiresAt", async () => {
      const createRes = await createSandbox({ ttlMinutes: 60 });
      const { data: created } = (await createRes.json()) as any;

      const res = await app.handle(
        post(`${BASE}/sandboxes/${created.sandboxId}/extend`, {
          additionalMinutes: 120,
        })
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.expiresAt).toBeTruthy();
    });

    it("POST /sandboxes/:id/start returns 404 for nonexistent", async () => {
      const res = await app.handle(
        post(`${BASE}/sandboxes/sbx_nonexistent/start`, {})
      );
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // Snapshots
  // =========================================================================
  describe("Snapshots", () => {
    it("POST /sandboxes/:id/snapshots creates snapshot", async () => {
      const createRes = await createSandbox();
      const { data: created } = (await createRes.json()) as any;

      const res = await app.handle(
        post(`${BASE}/sandboxes/${created.sandboxId}/snapshots`, {
          name: "my-snapshot",
          description: "A test snapshot",
        })
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.sandboxSnapshotId).toBeTruthy();
      expect(data.status).toBe("creating");
    });

    it("GET /sandboxes/:id/snapshots lists snapshots", async () => {
      const createRes = await createSandbox();
      const { data: created } = (await createRes.json()) as any;

      await app.handle(
        post(`${BASE}/sandboxes/${created.sandboxId}/snapshots`, {
          name: "snap-1",
        })
      );
      await app.handle(
        post(`${BASE}/sandboxes/${created.sandboxId}/snapshots`, {
          name: "snap-2",
        })
      );

      const res = await app.handle(
        new Request(`${BASE}/sandboxes/${created.sandboxId}/snapshots`)
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data).toHaveLength(2);
    });

    it("POST /sandbox-snapshots/:id/clone creates new sandbox", async () => {
      const createRes = await createSandbox();
      const { data: created } = (await createRes.json()) as any;

      const snapRes = await app.handle(
        post(`${BASE}/sandboxes/${created.sandboxId}/snapshots`, {
          name: "snap-for-clone",
        })
      );
      const { data: snap } = (await snapRes.json()) as any;

      const cloneRes = await app.handle(
        post(`${BASE}/sandbox-snapshots/${snap.sandboxSnapshotId}/clone`, {
          name: "cloned-sbx",
          ownerId: "user_2",
          ownerType: "user",
        })
      );
      expect(cloneRes.status).toBe(200);
      const { data: cloned } = (await cloneRes.json()) as any;
      expect(cloned.sandboxId).toBeTruthy();
      expect(cloned.sandboxId).not.toBe(created.sandboxId);
      expect(cloned.clonedFromSnapshotId).toBe(snap.sandboxSnapshotId);
    });

    it("POST /sandbox-snapshots/:id/clone returns 404 for nonexistent", async () => {
      const res = await app.handle(
        post(`${BASE}/sandbox-snapshots/snap_nonexistent/clone`, {
          name: "cloned",
          ownerId: "user_1",
          ownerType: "user",
        })
      );
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // Access
  // =========================================================================
  describe("Access", () => {
    it("POST /sandboxes/:id/access grants access", async () => {
      const createRes = await createSandbox();
      const { data: created } = (await createRes.json()) as any;

      const res = await app.handle(
        post(`${BASE}/sandboxes/${created.sandboxId}/access`, {
          principalId: "user_2",
          principalType: "user",
          role: "editor",
          grantedBy: "user_1",
        })
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.role).toBe("editor");
    });

    it("GET /sandboxes/:id/access lists access entries", async () => {
      const createRes = await createSandbox();
      const { data: created } = (await createRes.json()) as any;

      // Grant additional access
      await app.handle(
        post(`${BASE}/sandboxes/${created.sandboxId}/access`, {
          principalId: "user_2",
          principalType: "user",
          role: "viewer",
          grantedBy: "user_1",
        })
      );

      const res = await app.handle(
        new Request(`${BASE}/sandboxes/${created.sandboxId}/access`)
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      // Owner + user_2
      expect(data).toHaveLength(2);
    });

    it("DELETE /sandboxes/:id/access/:principalId revokes access", async () => {
      const createRes = await createSandbox();
      const { data: created } = (await createRes.json()) as any;

      await app.handle(
        post(`${BASE}/sandboxes/${created.sandboxId}/access`, {
          principalId: "user_2",
          principalType: "user",
          role: "editor",
          grantedBy: "user_1",
        })
      );

      const res = await app.handle(
        del(`${BASE}/sandboxes/${created.sandboxId}/access/user_2`)
      );
      expect(res.status).toBe(200);

      // Verify removed
      const listRes = await app.handle(
        new Request(`${BASE}/sandboxes/${created.sandboxId}/access`)
      );
      const { data } = (await listRes.json()) as any;
      expect(data).toHaveLength(1); // Only owner remains
    });
  });

  // =========================================================================
  // Templates
  // =========================================================================
  describe("Templates", () => {
    it("POST /sandbox-templates creates template", async () => {
      const res = await app.handle(
        post(`${BASE}/sandbox-templates`, {
          name: "Node Dev",
          runtimeType: "container",
          image: "node:20",
        })
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.sandboxTemplateId).toBeTruthy();
      expect(data.name).toBe("Node Dev");
    });

    it("GET /sandbox-templates lists templates", async () => {
      await app.handle(
        post(`${BASE}/sandbox-templates`, {
          name: "Tpl A",
          runtimeType: "container",
        })
      );
      await app.handle(
        post(`${BASE}/sandbox-templates`, {
          name: "Tpl B",
          runtimeType: "vm",
        })
      );

      const res = await app.handle(
        new Request(`${BASE}/sandbox-templates`)
      );
      const { data } = (await res.json()) as any;
      expect(data).toHaveLength(2);
    });

    it("GET /sandbox-templates filters by runtimeType", async () => {
      await app.handle(
        post(`${BASE}/sandbox-templates`, {
          name: "Container",
          runtimeType: "container",
        })
      );
      await app.handle(
        post(`${BASE}/sandbox-templates`, {
          name: "VM",
          runtimeType: "vm",
        })
      );

      const res = await app.handle(
        new Request(`${BASE}/sandbox-templates?runtimeType=container`)
      );
      const { data } = (await res.json()) as any;
      expect(data).toHaveLength(1);
      expect(data[0].name).toBe("Container");
    });

    it("DELETE /sandbox-templates/:id deletes template", async () => {
      const createRes = await app.handle(
        post(`${BASE}/sandbox-templates`, {
          name: "Delete Me",
          runtimeType: "container",
        })
      );
      const { data: created } = (await createRes.json()) as any;

      const res = await app.handle(
        del(`${BASE}/sandbox-templates/${created.sandboxTemplateId}`)
      );
      expect(res.status).toBe(200);

      // Verify gone
      const getRes = await app.handle(
        new Request(
          `${BASE}/sandbox-templates/${created.sandboxTemplateId}`
        )
      );
      expect(getRes.status).toBe(404);
    });
  });
});
