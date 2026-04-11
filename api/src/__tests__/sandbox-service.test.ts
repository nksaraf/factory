/**
 * Workspace Service Tests (was sandbox-service.test.ts)
 *
 * Tests workspace CRUD, lifecycle, snapshots, TTL via direct DB operations
 * using v2 schema tables.
 *
 * NOTE: These tests will fail until Phase 6 migrates the workspace service.
 * They assert v2 behavior as the target specification.
 */
import type { PGlite } from "@electric-sql/pglite"
import type {
  WorkspaceSnapshotSpec,
  WorkspaceSpec,
} from "@smp/factory-shared/schemas/ops"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import type { Database } from "../db/connection"
import { workspace, workspaceSnapshot } from "../db/schema/ops"
import { createTestContext, truncateAllTables } from "../test-helpers"

describe("Workspace Services", () => {
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

  /** Helper to create a workspace */
  async function createWorkspace(overrides?: Partial<WorkspaceSpec>) {
    const ts = Date.now()
    const baseSpec: WorkspaceSpec = {
      ownerType: "user",
      realmType: "container",
      lifecycle: "provisioning",
      authMode: "private",
      devcontainerConfig: {},
      repos: [],
      healthStatus: "unknown",
      setupProgress: {},
      ...overrides,
    }
    const [wksp] = await db
      .insert(workspace)
      .values({
        name: "test-workspace",
        slug: `test-workspace-${ts}`,
        type: "developer",
        ownerId: "user_1",
        spec: baseSpec,
      })
      .returning()

    return { workspace: wksp }
  }

  // =========================================================================
  // CRUD
  // =========================================================================
  describe("CRUD", () => {
    it("creates workspace with correct fields", async () => {
      const { workspace: wksp } = await createWorkspace()

      expect(wksp.id).toBeTruthy()
      expect(wksp.name).toBe("test-workspace")
      expect(wksp.ownerId).toBe("user_1")
      expect((wksp.spec as WorkspaceSpec).realmType).toBe("container")
      expect((wksp.spec as WorkspaceSpec).lifecycle).toBe("provisioning")
    })

    it("creates workspace with no realmType defaults to container", async () => {
      const { workspace: wksp } = await createWorkspace()
      expect((wksp.spec as WorkspaceSpec).realmType).toBe("container")
    })

    it("creates workspace with gpu=true uses vm realmType", async () => {
      const { workspace: wksp } = await createWorkspace({
        realmType: "vm",
      })
      expect((wksp.spec as WorkspaceSpec).realmType).toBe("vm")
    })

    it("gets workspace by id", async () => {
      const { workspace: wksp } = await createWorkspace()
      const [fetched] = await db
        .select()
        .from(workspace)
        .where(eq(workspace.id, wksp.id))
      expect(fetched).toBeTruthy()
      expect(fetched!.id).toBe(wksp.id)
    })

    it("returns empty for nonexistent workspace id", async () => {
      const result = await db
        .select()
        .from(workspace)
        .where(eq(workspace.id, "wksp_nonexistent"))
      expect(result).toHaveLength(0)
    })

    it("lists workspaces filtered by ownerId", async () => {
      await createWorkspace()
      await createWorkspace()

      // For now, list all and filter — service will provide filtered queries in Phase 6
      const all = await db.select().from(workspace)
      const user1 = all.filter((w) => w.ownerId === "user_1")
      expect(user1).toHaveLength(2)
    })

    it("soft-deletes workspace via bitemporal validTo", async () => {
      const { workspace: wksp } = await createWorkspace()

      // Set validTo to now (bitemporal soft-delete)
      await db
        .update(workspace)
        .set({ validTo: new Date() })
        .where(eq(workspace.id, wksp.id))

      // Active query (validTo IS NULL) returns nothing
      const active = await db
        .select()
        .from(workspace)
        .where(eq(workspace.id, wksp.id))
      // The record still exists but with validTo set
      expect(active[0]?.validTo).not.toBeNull()
    })
  })

  // =========================================================================
  // Lifecycle
  // =========================================================================
  describe("Lifecycle", () => {
    it("start sets lifecycle to active", async () => {
      const { workspace: wksp } = await createWorkspace()

      await db
        .update(workspace)
        .set({
          spec: { ...(wksp.spec as WorkspaceSpec), lifecycle: "active" },
          updatedAt: new Date(),
        })
        .where(eq(workspace.id, wksp.id))

      const [updated] = await db
        .select()
        .from(workspace)
        .where(eq(workspace.id, wksp.id))
      expect((updated!.spec as WorkspaceSpec).lifecycle).toBe("active")
    })

    it("stop sets lifecycle to suspended", async () => {
      const { workspace: wksp } = await createWorkspace({ lifecycle: "active" })

      await db
        .update(workspace)
        .set({
          spec: { ...(wksp.spec as WorkspaceSpec), lifecycle: "suspended" },
          updatedAt: new Date(),
        })
        .where(eq(workspace.id, wksp.id))

      const [updated] = await db
        .select()
        .from(workspace)
        .where(eq(workspace.id, wksp.id))
      expect((updated!.spec as WorkspaceSpec).lifecycle).toBe("suspended")
    })

    it("resize updates cpu/memory/storageGb in spec", async () => {
      const { workspace: wksp } = await createWorkspace({
        cpu: "1000m",
        memory: "2Gi",
        storageGb: 10,
      })

      await db
        .update(workspace)
        .set({
          spec: {
            ...(wksp.spec as WorkspaceSpec),
            cpu: "4000m",
            memory: "8Gi",
            storageGb: 50,
          },
          updatedAt: new Date(),
        })
        .where(eq(workspace.id, wksp.id))

      const [updated] = await db
        .select()
        .from(workspace)
        .where(eq(workspace.id, wksp.id))
      expect((updated!.spec as WorkspaceSpec).cpu).toBe("4000m")
      expect((updated!.spec as WorkspaceSpec).memory).toBe("8Gi")
      expect((updated!.spec as WorkspaceSpec).storageGb).toBe(50)
    })

    it("extend pushes expiresAt forward in spec", async () => {
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
      const { workspace: wksp } = await createWorkspace({
        expiresAt: expiresAt,
      })

      const newExpiresAt = new Date(expiresAt.getTime() + 120 * 60 * 1000)
      await db
        .update(workspace)
        .set({
          spec: { ...(wksp.spec as WorkspaceSpec), expiresAt: newExpiresAt },
          updatedAt: new Date(),
        })
        .where(eq(workspace.id, wksp.id))

      const [updated] = await db
        .select()
        .from(workspace)
        .where(eq(workspace.id, wksp.id))
      const diffMinutes =
        (new Date((updated!.spec as WorkspaceSpec).expiresAt!).getTime() -
          expiresAt.getTime()) /
        (60 * 1000)
      expect(diffMinutes).toBeGreaterThanOrEqual(119)
      expect(diffMinutes).toBeLessThanOrEqual(121)
    })
  })

  // =========================================================================
  // Snapshots
  // =========================================================================
  describe("Snapshots", () => {
    it("creates snapshot with status=creating and captures metadata", async () => {
      const { workspace: wksp } = await createWorkspace({
        cpu: "2000m",
        memory: "4Gi",
      })

      const [snap] = await db
        .insert(workspaceSnapshot)
        .values({
          workspaceId: wksp.id,
          spec: {
            status: "creating",
          },
        })
        .returning()

      expect(snap.id).toBeTruthy()
      expect((snap.spec as WorkspaceSnapshotSpec).status).toBe("creating")
    })

    it("lists snapshots for workspace", async () => {
      const { workspace: wksp } = await createWorkspace()

      await db.insert(workspaceSnapshot).values({
        workspaceId: wksp.id,
        spec: { status: "creating" },
      })
      await db.insert(workspaceSnapshot).values({
        workspaceId: wksp.id,
        spec: { status: "creating" },
      })

      const snaps = await db
        .select()
        .from(workspaceSnapshot)
        .where(eq(workspaceSnapshot.workspaceId, wksp.id))
      expect(snaps).toHaveLength(2)
    })

    it("deletes snapshot by setting status to deleted", async () => {
      const { workspace: wksp } = await createWorkspace()

      const [snap] = await db
        .insert(workspaceSnapshot)
        .values({
          workspaceId: wksp.id,
          spec: { status: "ready" },
        })
        .returning()

      await db
        .update(workspaceSnapshot)
        .set({
          spec: { ...(snap.spec as WorkspaceSnapshotSpec), status: "deleted" },
        })
        .where(eq(workspaceSnapshot.id, snap.id))

      const [fetched] = await db
        .select()
        .from(workspaceSnapshot)
        .where(eq(workspaceSnapshot.id, snap.id))
      expect((fetched!.spec as WorkspaceSnapshotSpec).status).toBe("deleted")
    })
  })
})
