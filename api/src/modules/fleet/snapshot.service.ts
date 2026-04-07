import { desc, eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { workspace, workspaceSnapshot } from "../../db/schema/ops";
import type { SandboxAdapter } from "../../adapters/sandbox-adapter";
import { createWorkspace, destroyWorkspace } from "./workspace.service";

// ---------------------------------------------------------------------------
// Snapshot CRUD — v2: workspaceSnapshot in ops schema
// ---------------------------------------------------------------------------

export async function createSnapshot(
  db: Database,
  adapter: SandboxAdapter,
  input: {
    workspaceId?: string;
    sandboxId?: string;
    createdBy: string;
    stop?: boolean;
  },
) {
  const wsId = input.workspaceId ?? input.sandboxId!;
  const result = await adapter.snapshot(wsId);

  const [row] = await db
    .insert(workspaceSnapshot)
    .values({
      workspaceId: wsId,
      spec: {
        name: `snapshot-${Date.now()}`,
        runtimeType: "container",
        config: result.config,
        createdBy: input.createdBy,
      } as any,
    })
    .returning();

  if (input.stop) {
    await destroyWorkspace(db, wsId);
  }

  return row;
}

export async function listSnapshots(
  db: Database,
  opts?: { workspaceId?: string; sandboxId?: string },
) {
  const wsId = opts?.workspaceId ?? opts?.sandboxId;
  const base = db.select().from(workspaceSnapshot);
  const rows = wsId
    ? await base
        .where(eq(workspaceSnapshot.workspaceId, wsId))
        .orderBy(desc(workspaceSnapshot.createdAt))
    : await base.orderBy(desc(workspaceSnapshot.createdAt));

  return { data: rows, total: rows.length };
}

export async function getSnapshot(db: Database, snapshotId: string) {
  const [row] = await db
    .select()
    .from(workspaceSnapshot)
    .where(eq(workspaceSnapshot.id, snapshotId))
    .limit(1);

  return row ?? null;
}

export async function updateSnapshotStatus(
  db: Database,
  snapshotId: string,
  status: "ready" | "failed",
  extra?: { sizeBytes?: number; volumeSnapshotName?: string },
) {
  const [existing] = await db
    .select()
    .from(workspaceSnapshot)
    .where(eq(workspaceSnapshot.id, snapshotId))
    .limit(1);
  if (!existing) return;

  const spec = (existing.spec ?? {}) as Record<string, any>;
  await db
    .update(workspaceSnapshot)
    .set({
      spec: {
        ...spec,
        status,
        ...(extra?.sizeBytes != null ? { sizeBytes: extra.sizeBytes } : {}),
        ...(extra?.volumeSnapshotName ? { volumeSnapshotName: extra.volumeSnapshotName } : {}),
      } as any,
    })
    .where(eq(workspaceSnapshot.id, snapshotId));
}

// ---------------------------------------------------------------------------
// Restore from snapshot
// ---------------------------------------------------------------------------

export async function restoreFromSnapshot(
  db: Database,
  workspaceId: string,
  snapshotId: string,
) {
  const snap = await getSnapshot(db, snapshotId);
  if (!snap) throw new Error(`Snapshot not found: ${snapshotId}`);

  const snapSpec = (snap.spec ?? {}) as Record<string, any>;
  const config = snapSpec.config ?? {};

  const [existing] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  if (!existing) throw new Error(`Workspace not found: ${workspaceId}`);

  const wsSpec = (existing.spec ?? {}) as Record<string, any>;
  const [updated] = await db
    .update(workspace)
    .set({
      spec: {
        ...wsSpec,
        devcontainerConfig: config.devcontainerConfig ?? wsSpec.devcontainerConfig,
        devcontainerImage: config.devcontainerImage ?? wsSpec.devcontainerImage,
        repos: config.repos ?? wsSpec.repos,
        cpu: config.cpu ?? wsSpec.cpu,
        memory: config.memory ?? wsSpec.memory,
        storageGb: config.storageGb ?? wsSpec.storageGb,
        dockerCacheGb: config.dockerCacheGb ?? wsSpec.dockerCacheGb,
      } as any,
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, workspaceId))
    .returning();

  return updated!;
}

// ---------------------------------------------------------------------------
// Clone from snapshot
// ---------------------------------------------------------------------------

export async function cloneFromSnapshot(
  db: Database,
  snapshotId: string,
  data: { name: string; ownerId: string; ownerType: "user" | "agent" },
) {
  const snap = await getSnapshot(db, snapshotId);
  if (!snap) throw new Error(`Snapshot not found: ${snapshotId}`);

  const snapSpec = (snap.spec ?? {}) as Record<string, any>;
  const config = snapSpec.config ?? {};

  const ws = await createWorkspace(db, {
    name: data.name,
    ownerId: data.ownerId,
    type: data.ownerType === "agent" ? "agent" : "developer",
  });

  // Overlay snapshot config into new workspace spec
  const wsSpec = (ws.spec ?? {}) as Record<string, any>;
  const [updated] = await db
    .update(workspace)
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
        runtimeType: snapSpec.runtimeType ?? "container",
        clonedFromSnapshotId: snapshotId,
      } as any,
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, ws.id))
    .returning();

  return updated!;
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteSnapshot(db: Database, snapshotId: string) {
  const [deleted] = await db
    .delete(workspaceSnapshot)
    .where(eq(workspaceSnapshot.id, snapshotId))
    .returning();

  return deleted ?? null;
}
