import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestContext, truncateAllTables } from "../test-helpers";
import * as sandboxSvc from "../services/sandbox/sandbox.service";
import * as templateSvc from "../services/sandbox/sandbox-template.service";
import { deploymentTarget } from "../db/schema/fleet";
import type { Database } from "../db/connection";
import type { PGlite } from "@electric-sql/pglite";

describe("Sandbox Services", () => {
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

  // =========================================================================
  // CRUD
  // =========================================================================
  describe("CRUD", () => {
    it("createSandbox creates deployment target (kind=sandbox) + sandbox", async () => {
      const sbx = await sandboxSvc.createSandbox(db, {
        name: "test-sandbox",
        ownerId: "user_1",
        ownerType: "user",
      });

      expect(sbx.sandboxId).toBeTruthy();
      expect(sbx.name).toBe("test-sandbox");
      expect(sbx.ownerId).toBe("user_1");
      expect(sbx.runtimeType).toBe("container");

      // Verify deployment target was created via getSandbox join
      const fetched = await sandboxSvc.getSandbox(db, sbx.sandboxId);
      expect(fetched).not.toBeNull();
      expect(fetched!.status).toBe("provisioning");
    });

    it("createSandbox with no runtimeType auto-selects container", async () => {
      const sbx = await sandboxSvc.createSandbox(db, {
        name: "auto-rt",
        ownerId: "user_1",
        ownerType: "user",
      });
      expect(sbx.runtimeType).toBe("container");
    });

    it("createSandbox with gpu=true auto-selects vm", async () => {
      const sbx = await sandboxSvc.createSandbox(db, {
        name: "gpu-sandbox",
        ownerId: "user_1",
        ownerType: "user",
        gpu: true,
      });
      expect(sbx.runtimeType).toBe("vm");
    });

    it("getSandbox returns sandbox with deployment target status", async () => {
      const sbx = await sandboxSvc.createSandbox(db, {
        name: "get-test",
        ownerId: "user_1",
        ownerType: "user",
      });
      const fetched = await sandboxSvc.getSandbox(db, sbx.sandboxId);
      expect(fetched).not.toBeNull();
      expect(fetched!.sandboxId).toBe(sbx.sandboxId);
      expect(fetched!.status).toBe("provisioning");
    });

    it("getSandbox returns null for nonexistent", async () => {
      const fetched = await sandboxSvc.getSandbox(db, "sbx_nonexistent");
      expect(fetched).toBeNull();
    });

    it("listSandboxes filters by ownerId", async () => {
      await sandboxSvc.createSandbox(db, {
        name: "sbx-a",
        ownerId: "user_1",
        ownerType: "user",
      });
      await sandboxSvc.createSandbox(db, {
        name: "sbx-b",
        ownerId: "user_2",
        ownerType: "user",
      });

      const list = await sandboxSvc.listSandboxes(db, { ownerId: "user_1" });
      expect(list).toHaveLength(1);
      expect(list[0].ownerId).toBe("user_1");
    });

    it("listSandboxes filters by runtimeType", async () => {
      await sandboxSvc.createSandbox(db, {
        name: "container-sbx",
        ownerId: "user_1",
        ownerType: "user",
        runtimeType: "container",
      });
      await sandboxSvc.createSandbox(db, {
        name: "vm-sbx",
        ownerId: "user_1",
        ownerType: "user",
        runtimeType: "vm",
      });

      const list = await sandboxSvc.listSandboxes(db, {
        runtimeType: "container",
      });
      expect(list).toHaveLength(1);
      expect(list[0].runtimeType).toBe("container");
    });

    it("listSandboxes filters by status", async () => {
      const sbx = await sandboxSvc.createSandbox(db, {
        name: "status-test",
        ownerId: "user_1",
        ownerType: "user",
      });
      await sandboxSvc.startSandbox(db, sbx.sandboxId);

      const active = await sandboxSvc.listSandboxes(db, { status: "active" });
      expect(active).toHaveLength(1);

      const prov = await sandboxSvc.listSandboxes(db, {
        status: "provisioning",
      });
      expect(prov).toHaveLength(0);
    });

    it("deleteSandbox sets status to destroying", async () => {
      const sbx = await sandboxSvc.createSandbox(db, {
        name: "delete-test",
        ownerId: "user_1",
        ownerType: "user",
      });
      await sandboxSvc.deleteSandbox(db, sbx.sandboxId);

      const fetched = await sandboxSvc.getSandbox(db, sbx.sandboxId);
      expect(fetched!.status).toBe("destroying");
    });
  });

  // =========================================================================
  // Lifecycle
  // =========================================================================
  describe("Lifecycle", () => {
    it("startSandbox sets deployment target status to active", async () => {
      const sbx = await sandboxSvc.createSandbox(db, {
        name: "start-test",
        ownerId: "user_1",
        ownerType: "user",
      });

      const started = await sandboxSvc.startSandbox(db, sbx.sandboxId);
      expect(started.status).toBe("active");
    });

    it("stopSandbox sets deployment target status to suspended", async () => {
      const sbx = await sandboxSvc.createSandbox(db, {
        name: "stop-test",
        ownerId: "user_1",
        ownerType: "user",
      });
      await sandboxSvc.startSandbox(db, sbx.sandboxId);

      const stopped = await sandboxSvc.stopSandbox(db, sbx.sandboxId);
      expect(stopped.status).toBe("suspended");
    });

    it("resizeSandbox updates cpu/memory/storageGb", async () => {
      const sbx = await sandboxSvc.createSandbox(db, {
        name: "resize-test",
        ownerId: "user_1",
        ownerType: "user",
        cpu: "1000m",
        memory: "2Gi",
        storageGb: 10,
      });

      const resized = await sandboxSvc.resizeSandbox(db, sbx.sandboxId, {
        cpu: "4000m",
        memory: "8Gi",
        storageGb: 50,
      });
      expect(resized.cpu).toBe("4000m");
      expect(resized.memory).toBe("8Gi");
      expect(resized.storageGb).toBe(50);
    });

    it("extendSandbox pushes expiresAt forward", async () => {
      const sbx = await sandboxSvc.createSandbox(db, {
        name: "extend-test",
        ownerId: "user_1",
        ownerType: "user",
        ttlMinutes: 60,
      });

      const before = await sandboxSvc.getSandbox(db, sbx.sandboxId);
      expect(before!.expiresAt).not.toBeNull();
      const beforeTime = new Date(before!.expiresAt!).getTime();

      const extended = await sandboxSvc.extendSandbox(db, sbx.sandboxId, 120);
      const afterTime = new Date(extended.expiresAt!).getTime();
      // Should be ~120 minutes later than the original expiresAt
      const diffMinutes = (afterTime - beforeTime) / (60 * 1000);
      expect(diffMinutes).toBeGreaterThanOrEqual(119);
      expect(diffMinutes).toBeLessThanOrEqual(121);
    });
  });

  // =========================================================================
  // Snapshots
  // =========================================================================
  describe("Snapshots", () => {
    it("snapshotSandbox creates snapshot with status=creating and captures metadata", async () => {
      const sbx = await sandboxSvc.createSandbox(db, {
        name: "snap-test",
        ownerId: "user_1",
        ownerType: "user",
        cpu: "2000m",
        memory: "4Gi",
      });

      const snap = await sandboxSvc.snapshotSandbox(db, sbx.sandboxId, {
        name: "snap-1",
        description: "First snapshot",
      });

      expect(snap.sandboxSnapshotId).toBeTruthy();
      expect(snap.status).toBe("creating");
      expect(snap.name).toBe("snap-1");
      expect(snap.description).toBe("First snapshot");

      const meta = snap.snapshotMetadata as Record<string, any>;
      expect(meta.cpu).toBe("2000m");
      expect(meta.memory).toBe("4Gi");
    });

    it("listSnapshots returns snapshots for sandbox", async () => {
      const sbx = await sandboxSvc.createSandbox(db, {
        name: "list-snap",
        ownerId: "user_1",
        ownerType: "user",
      });
      await sandboxSvc.snapshotSandbox(db, sbx.sandboxId, { name: "s1" });
      await sandboxSvc.snapshotSandbox(db, sbx.sandboxId, { name: "s2" });

      const snaps = await sandboxSvc.listSnapshots(db, sbx.sandboxId);
      expect(snaps).toHaveLength(2);
    });

    it("deleteSnapshot sets status to deleted", async () => {
      const sbx = await sandboxSvc.createSandbox(db, {
        name: "del-snap",
        ownerId: "user_1",
        ownerType: "user",
      });
      const snap = await sandboxSvc.snapshotSandbox(db, sbx.sandboxId, {
        name: "s1",
      });

      await sandboxSvc.deleteSnapshot(db, snap.sandboxSnapshotId);
      const fetched = await sandboxSvc.getSnapshot(db, snap.sandboxSnapshotId);
      expect(fetched!.status).toBe("deleted");
    });

    it("restoreSandbox updates sandbox config from snapshot metadata", async () => {
      const sbx = await sandboxSvc.createSandbox(db, {
        name: "restore-test",
        ownerId: "user_1",
        ownerType: "user",
        cpu: "1000m",
        memory: "2Gi",
      });

      const snap = await sandboxSvc.snapshotSandbox(db, sbx.sandboxId, {
        name: "before-resize",
      });

      // Resize after snapshot
      await sandboxSvc.resizeSandbox(db, sbx.sandboxId, {
        cpu: "4000m",
        memory: "8Gi",
      });

      // Restore
      const restored = await sandboxSvc.restoreSandbox(
        db,
        sbx.sandboxId,
        snap.sandboxSnapshotId
      );
      expect(restored.cpu).toBe("1000m");
      expect(restored.memory).toBe("2Gi");
    });

    it("cloneSandbox creates new sandbox + deployment target with clonedFromSnapshotId", async () => {
      const sbx = await sandboxSvc.createSandbox(db, {
        name: "clone-src",
        ownerId: "user_1",
        ownerType: "user",
        cpu: "2000m",
      });
      const snap = await sandboxSvc.snapshotSandbox(db, sbx.sandboxId, {
        name: "snap-for-clone",
      });

      const cloned = await sandboxSvc.cloneSandbox(
        db,
        snap.sandboxSnapshotId,
        {
          name: "cloned-sandbox",
          ownerId: "user_2",
          ownerType: "user",
        }
      );

      expect(cloned.sandboxId).toBeTruthy();
      expect(cloned.sandboxId).not.toBe(sbx.sandboxId);
      expect(cloned.name).toBe("cloned-sandbox");
      expect(cloned.clonedFromSnapshotId).toBe(snap.sandboxSnapshotId);

      // Verify deployment target was created
      const fetched = await sandboxSvc.getSandbox(db, cloned.sandboxId);
      expect(fetched).not.toBeNull();
      expect(fetched!.status).toBe("provisioning");
    });
  });

  // =========================================================================
  // TTL
  // =========================================================================
  describe("TTL", () => {
    it("expireStale finds past-TTL sandboxes and sets status=destroying", async () => {
      const sbx = await sandboxSvc.createSandbox(db, {
        name: "ttl-test",
        ownerId: "user_1",
        ownerType: "user",
        ttlMinutes: 60,
      });

      // Start it so it's in active state (expireStale only targets active sandboxes)
      await sandboxSvc.startSandbox(db, sbx.sandboxId);

      // Manually set expiresAt to the past
      const fetched = await sandboxSvc.getSandbox(db, sbx.sandboxId);
      await db
        .update(deploymentTarget)
        .set({ expiresAt: new Date(Date.now() - 60 * 1000) })
        .where(
          eq(
            deploymentTarget.deploymentTargetId,
            fetched!.deploymentTargetId
          )
        );

      const count = await sandboxSvc.expireStale(db);
      expect(count).toBe(1);

      const after = await sandboxSvc.getSandbox(db, sbx.sandboxId);
      expect(after!.status).toBe("destroying");
    });

    it("expireStale does not affect non-expired sandboxes", async () => {
      const sbx = await sandboxSvc.createSandbox(db, {
        name: "ttl-safe",
        ownerId: "user_1",
        ownerType: "user",
        ttlMinutes: 60,
      });
      await sandboxSvc.startSandbox(db, sbx.sandboxId);

      const count = await sandboxSvc.expireStale(db);
      expect(count).toBe(0);

      const after = await sandboxSvc.getSandbox(db, sbx.sandboxId);
      expect(after!.status).toBe("active");
    });
  });

  // =========================================================================
  // Templates
  // =========================================================================
  describe("Templates", () => {
    it("createTemplate inserts a template", async () => {
      const tpl = await templateSvc.createTemplate(db, {
        name: "Node Dev",
        runtimeType: "container",
        image: "node:20",
        defaultCpu: "1000m",
        defaultMemory: "2Gi",
      });

      expect(tpl.sandboxTemplateId).toBeTruthy();
      expect(tpl.name).toBe("Node Dev");
      expect(tpl.slug).toBeTruthy();
    });

    it("listTemplates filters by runtimeType", async () => {
      await templateSvc.createTemplate(db, {
        name: "Container Tpl",
        runtimeType: "container",
      });
      await templateSvc.createTemplate(db, {
        name: "VM Tpl",
        runtimeType: "vm",
      });

      const containers = await templateSvc.listTemplates(db, {
        runtimeType: "container",
      });
      expect(containers).toHaveLength(1);
      expect(containers[0].name).toBe("Container Tpl");
    });

    it("getTemplateBySlug returns template by slug", async () => {
      const tpl = await templateSvc.createTemplate(db, {
        name: "Slug Test",
        runtimeType: "container",
      });

      const fetched = await templateSvc.getTemplateBySlug(db, tpl.slug);
      expect(fetched).not.toBeNull();
      expect(fetched!.sandboxTemplateId).toBe(tpl.sandboxTemplateId);
    });

    it("deleteTemplate removes template", async () => {
      const tpl = await templateSvc.createTemplate(db, {
        name: "Delete Me",
        runtimeType: "container",
      });

      await templateSvc.deleteTemplate(db, tpl.sandboxTemplateId);

      const fetched = await templateSvc.getTemplate(db, tpl.sandboxTemplateId);
      expect(fetched).toBeNull();
    });
  });
});
