import { desc, eq } from "drizzle-orm"

import type { SandboxAdapter } from "../../adapters/sandbox-adapter"
import type { Database } from "../../db/connection"
import { workbench, workbenchSnapshot } from "../../db/schema/ops"
import { createWorkbench, destroyWorkbench } from "./workbench.service"

// ---------------------------------------------------------------------------
// Snapshot CRUD — workbenchSnapshot in ops schema
// ---------------------------------------------------------------------------

export async function createSnapshot(
  db: Database,
  adapter: SandboxAdapter,
  input: {
    workbenchId?: string
    sandboxId?: string
    createdBy: string
    stop?: boolean
  }
) {
  const wsId = input.workbenchId ?? input.sandboxId!
  const result = await adapter.snapshot(wsId)

  const [row] = await db
    .insert(workbenchSnapshot)
    .values({
      workbenchId: wsId,
      spec: {
        name: `snapshot-${Date.now()}`,
        realmType: "container",
        config: result.config,
        createdBy: input.createdBy,
      } as any,
    })
    .returning()

  if (input.stop) {
    await destroyWorkbench(db, wsId)
  }

  return row
}

export async function listSnapshots(
  db: Database,
  opts?: { workbenchId?: string; sandboxId?: string }
) {
  const wsId = opts?.workbenchId ?? opts?.sandboxId
  const base = db.select().from(workbenchSnapshot)
  const rows = wsId
    ? await base
        .where(eq(workbenchSnapshot.workbenchId, wsId))
        .orderBy(desc(workbenchSnapshot.createdAt))
    : await base.orderBy(desc(workbenchSnapshot.createdAt))

  return { data: rows, total: rows.length }
}

export async function getSnapshot(db: Database, snapshotId: string) {
  const [row] = await db
    .select()
    .from(workbenchSnapshot)
    .where(eq(workbenchSnapshot.id, snapshotId))
    .limit(1)

  return row ?? null
}

export async function updateSnapshotStatus(
  db: Database,
  snapshotId: string,
  status: "ready" | "failed",
  extra?: { sizeBytes?: number; volumeSnapshotName?: string }
) {
  const [existing] = await db
    .select()
    .from(workbenchSnapshot)
    .where(eq(workbenchSnapshot.id, snapshotId))
    .limit(1)
  if (!existing) return

  const spec = (existing.spec ?? {}) as Record<string, any>
  await db
    .update(workbenchSnapshot)
    .set({
      spec: {
        ...spec,
        status,
        ...(extra?.sizeBytes != null ? { sizeBytes: extra.sizeBytes } : {}),
        ...(extra?.volumeSnapshotName
          ? { volumeSnapshotName: extra.volumeSnapshotName }
          : {}),
      } as any,
    })
    .where(eq(workbenchSnapshot.id, snapshotId))
}

// ---------------------------------------------------------------------------
// Restore from snapshot
// ---------------------------------------------------------------------------

export async function restoreFromSnapshot(
  db: Database,
  workbenchId: string,
  snapshotId: string
) {
  const snap = await getSnapshot(db, snapshotId)
  if (!snap) throw new Error(`Snapshot not found: ${snapshotId}`)

  const snapSpec = (snap.spec ?? {}) as Record<string, any>
  const config = snapSpec.config ?? {}

  const [existing] = await db
    .select()
    .from(workbench)
    .where(eq(workbench.id, workbenchId))
    .limit(1)
  if (!existing) throw new Error(`Workbench not found: ${workbenchId}`)

  const wsSpec = (existing.spec ?? {}) as Record<string, any>
  const [updated] = await db
    .update(workbench)
    .set({
      spec: {
        ...wsSpec,
        devcontainerConfig:
          config.devcontainerConfig ?? wsSpec.devcontainerConfig,
        devcontainerImage: config.devcontainerImage ?? wsSpec.devcontainerImage,
        repos: config.repos ?? wsSpec.repos,
        cpu: config.cpu ?? wsSpec.cpu,
        memory: config.memory ?? wsSpec.memory,
        storageGb: config.storageGb ?? wsSpec.storageGb,
        dockerCacheGb: config.dockerCacheGb ?? wsSpec.dockerCacheGb,
      } as any,
      updatedAt: new Date(),
    })
    .where(eq(workbench.id, workbenchId))
    .returning()

  return updated!
}

// ---------------------------------------------------------------------------
// Clone from snapshot
// ---------------------------------------------------------------------------

export async function cloneFromSnapshot(
  db: Database,
  snapshotId: string,
  data: { name: string; ownerId: string; ownerType: "user" | "agent" }
) {
  const snap = await getSnapshot(db, snapshotId)
  if (!snap) throw new Error(`Snapshot not found: ${snapshotId}`)

  const snapSpec = (snap.spec ?? {}) as Record<string, any>
  const config = snapSpec.config ?? {}

  const ws = await createWorkbench(db, {
    name: data.name,
    ownerId: data.ownerId,
    type: data.ownerType === "agent" ? "agent" : "developer",
  })

  // Overlay snapshot config into new workbench spec
  const wsSpec = (ws.spec ?? {}) as Record<string, any>
  const [updated] = await db
    .update(workbench)
    .set({
      spec: {
        ...wsSpec,
        devcontainerConfig: config.devcontainerConfig ?? {},
        devcontainerImage: config.devcontainerImage,
        repos: config.repos ?? [],
        cpu: config.cpu,
        memory: config.memory,
        storageGb: config.storageGb ?? 10,
        dockerCacheGb: config.dockerCacheGb ?? 20,
        realmType: snapSpec.realmType ?? "container",
        clonedFromSnapshotId: snapshotId,
      } as any,
      updatedAt: new Date(),
    })
    .where(eq(workbench.id, ws.id))
    .returning()

  return updated!
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteSnapshot(db: Database, snapshotId: string) {
  const [deleted] = await db
    .delete(workbenchSnapshot)
    .where(eq(workbenchSnapshot.id, snapshotId))
    .returning()

  return deleted ?? null
}
