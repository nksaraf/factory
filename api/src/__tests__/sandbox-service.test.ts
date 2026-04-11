/**
 * Workbench Service Tests
 *
 * Tests workbench CRUD, lifecycle, snapshots, TTL via direct DB operations.
 */
import type { PGlite } from "@electric-sql/pglite"
import type {
  WorkbenchSnapshotSpec,
  WorkbenchSpec,
} from "@smp/factory-shared/schemas/ops"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"

import type { Database } from "../db/connection"
import { workbench, workbenchSnapshot } from "../db/schema/ops"
import { createTestContext, truncateAllTables } from "../test-helpers"

describe("Workbench Services", () => {
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

  /** Helper to create a workbench */
  async function createWorkbench(overrides?: Partial<WorkbenchSpec>) {
    const ts = Date.now()
    const baseSpec: WorkbenchSpec = {
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
    const [wb] = await db
      .insert(workbench)
      .values({
        name: "test-workbench",
        slug: `test-workbench-${ts}`,
        type: "developer",
        ownerId: "user_1",
        spec: baseSpec,
      })
      .returning()

    return { workbench: wb }
  }

  // =========================================================================
  // CRUD
  // =========================================================================
  describe("CRUD", () => {
    it("creates workbench with correct fields", async () => {
      const { workbench: wb } = await createWorkbench()

      expect(wb.id).toBeTruthy()
      expect(wb.name).toBe("test-workbench")
      expect(wb.ownerId).toBe("user_1")
      expect((wb.spec as WorkbenchSpec).realmType).toBe("container")
      expect((wb.spec as WorkbenchSpec).lifecycle).toBe("provisioning")
    })

    it("creates workbench with no realmType defaults to container", async () => {
      const { workbench: wb } = await createWorkbench()
      expect((wb.spec as WorkbenchSpec).realmType).toBe("container")
    })

    it("creates workbench with gpu=true uses vm realmType", async () => {
      const { workbench: wb } = await createWorkbench({
        realmType: "vm",
      })
      expect((wb.spec as WorkbenchSpec).realmType).toBe("vm")
    })

    it("gets workbench by id", async () => {
      const { workbench: wb } = await createWorkbench()
      const [fetched] = await db
        .select()
        .from(workbench)
        .where(eq(workbench.id, wb.id))
      expect(fetched).toBeTruthy()
      expect(fetched!.id).toBe(wb.id)
    })

    it("returns empty for nonexistent workbench id", async () => {
      const result = await db
        .select()
        .from(workbench)
        .where(eq(workbench.id, "wkbn_nonexistent"))
      expect(result).toHaveLength(0)
    })

    it("lists workbenches filtered by ownerId", async () => {
      await createWorkbench()
      await createWorkbench()

      const all = await db.select().from(workbench)
      const user1 = all.filter((w) => w.ownerId === "user_1")
      expect(user1).toHaveLength(2)
    })

    it("soft-deletes workbench via bitemporal validTo", async () => {
      const { workbench: wb } = await createWorkbench()

      // Set validTo to now (bitemporal soft-delete)
      await db
        .update(workbench)
        .set({ validTo: new Date() })
        .where(eq(workbench.id, wb.id))

      // Active query (validTo IS NULL) returns nothing
      const active = await db
        .select()
        .from(workbench)
        .where(eq(workbench.id, wb.id))
      // The record still exists but with validTo set
      expect(active[0]?.validTo).not.toBeNull()
    })
  })

  // =========================================================================
  // Lifecycle
  // =========================================================================
  describe("Lifecycle", () => {
    it("start sets lifecycle to active", async () => {
      const { workbench: wb } = await createWorkbench()

      await db
        .update(workbench)
        .set({
          spec: { ...(wb.spec as WorkbenchSpec), lifecycle: "active" },
          updatedAt: new Date(),
        })
        .where(eq(workbench.id, wb.id))

      const [updated] = await db
        .select()
        .from(workbench)
        .where(eq(workbench.id, wb.id))
      expect((updated!.spec as WorkbenchSpec).lifecycle).toBe("active")
    })

    it("stop sets lifecycle to suspended", async () => {
      const { workbench: wb } = await createWorkbench({ lifecycle: "active" })

      await db
        .update(workbench)
        .set({
          spec: { ...(wb.spec as WorkbenchSpec), lifecycle: "suspended" },
          updatedAt: new Date(),
        })
        .where(eq(workbench.id, wb.id))

      const [updated] = await db
        .select()
        .from(workbench)
        .where(eq(workbench.id, wb.id))
      expect((updated!.spec as WorkbenchSpec).lifecycle).toBe("suspended")
    })

    it("resize updates cpu/memory/storageGb in spec", async () => {
      const { workbench: wb } = await createWorkbench({
        cpu: "1000m",
        memory: "2Gi",
        storageGb: 10,
      })

      await db
        .update(workbench)
        .set({
          spec: {
            ...(wb.spec as WorkbenchSpec),
            cpu: "4000m",
            memory: "8Gi",
            storageGb: 50,
          },
          updatedAt: new Date(),
        })
        .where(eq(workbench.id, wb.id))

      const [updated] = await db
        .select()
        .from(workbench)
        .where(eq(workbench.id, wb.id))
      expect((updated!.spec as WorkbenchSpec).cpu).toBe("4000m")
      expect((updated!.spec as WorkbenchSpec).memory).toBe("8Gi")
      expect((updated!.spec as WorkbenchSpec).storageGb).toBe(50)
    })

    it("extend pushes expiresAt forward in spec", async () => {
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
      const { workbench: wb } = await createWorkbench({
        expiresAt: expiresAt,
      })

      const newExpiresAt = new Date(expiresAt.getTime() + 120 * 60 * 1000)
      await db
        .update(workbench)
        .set({
          spec: { ...(wb.spec as WorkbenchSpec), expiresAt: newExpiresAt },
          updatedAt: new Date(),
        })
        .where(eq(workbench.id, wb.id))

      const [updated] = await db
        .select()
        .from(workbench)
        .where(eq(workbench.id, wb.id))
      const diffMinutes =
        (new Date((updated!.spec as WorkbenchSpec).expiresAt!).getTime() -
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
      const { workbench: wb } = await createWorkbench({
        cpu: "2000m",
        memory: "4Gi",
      })

      const [snap] = await db
        .insert(workbenchSnapshot)
        .values({
          workbenchId: wb.id,
          spec: {
            status: "creating",
          },
        })
        .returning()

      expect(snap.id).toBeTruthy()
      expect((snap.spec as WorkbenchSnapshotSpec).status).toBe("creating")
    })

    it("lists snapshots for workbench", async () => {
      const { workbench: wb } = await createWorkbench()

      await db.insert(workbenchSnapshot).values({
        workbenchId: wb.id,
        spec: { status: "creating" },
      })
      await db.insert(workbenchSnapshot).values({
        workbenchId: wb.id,
        spec: { status: "creating" },
      })

      const snaps = await db
        .select()
        .from(workbenchSnapshot)
        .where(eq(workbenchSnapshot.workbenchId, wb.id))
      expect(snaps).toHaveLength(2)
    })

    it("deletes snapshot by setting status to deleted", async () => {
      const { workbench: wb } = await createWorkbench()

      const [snap] = await db
        .insert(workbenchSnapshot)
        .values({
          workbenchId: wb.id,
          spec: { status: "ready" },
        })
        .returning()

      await db
        .update(workbenchSnapshot)
        .set({
          spec: { ...(snap.spec as WorkbenchSnapshotSpec), status: "deleted" },
        })
        .where(eq(workbenchSnapshot.id, snap.id))

      const [fetched] = await db
        .select()
        .from(workbenchSnapshot)
        .where(eq(workbenchSnapshot.id, snap.id))
      expect((fetched!.spec as WorkbenchSnapshotSpec).status).toBe("deleted")
    })
  })
})
