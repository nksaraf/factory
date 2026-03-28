import { and, eq, lt } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { allocateSlug } from "../../lib/slug";
import {
  sandbox,
  sandboxTemplate,
  sandboxSnapshot,
  deploymentTarget,
} from "../../db/schema/fleet";
import { cluster } from "../../db/schema/infra";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateSandboxInput {
  name: string;
  slug?: string;
  runtimeType?: "container" | "vm";
  templateId?: string;
  devcontainerConfig?: Record<string, unknown>;
  devcontainerImage?: string;
  ownerId: string;
  ownerType: "user" | "agent";
  repos?: Array<{ url: string; branch?: string; clonePath?: string }>;
  cpu?: string;
  memory?: string;
  storageGb?: number;
  dockerCacheGb?: number;
  ttlMinutes?: number;
  trigger?: "manual" | "pr" | "release" | "agent" | "ci";
  gpu?: boolean;
  clusterId?: string;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createSandbox(db: Database, data: CreateSandboxInput) {
  // 1. Auto-select runtimeType: GPU -> vm, else -> container
  const runtimeType: "container" | "vm" =
    data.runtimeType ?? (data.gpu ? "vm" : "container");

  // 2. Resolve devcontainerImage: explicit > template > undefined
  let devcontainerImage = data.devcontainerImage;
  let template: typeof sandboxTemplate.$inferSelect | undefined;

  if (data.templateId) {
    const rows = await db
      .select()
      .from(sandboxTemplate)
      .where(eq(sandboxTemplate.sandboxTemplateId, data.templateId));
    template = rows[0];
  }

  if (!devcontainerImage && template) {
    devcontainerImage = template.image ?? undefined;
  }

  // 3. Allocate slug
  const slug = await allocateSlug({
    baseLabel: data.name,
    explicitSlug: data.slug,
    isTaken: async (s) => {
      const [r] = await db
        .select()
        .from(sandbox)
        .where(eq(sandbox.slug, s))
        .limit(1);
      return r != null;
    },
  });

  // Also allocate a slug for the deployment target (same base)
  const dtSlug = await allocateSlug({
    baseLabel: data.name,
    explicitSlug: undefined,
    isTaken: async (s) => {
      const [r] = await db
        .select()
        .from(deploymentTarget)
        .where(eq(deploymentTarget.slug, s))
        .limit(1);
      return r != null;
    },
  });

  // 4. Compute expiresAt from ttl
  const ttlMinutes =
    data.ttlMinutes ?? template?.defaultTtlMinutes ?? undefined;
  const expiresAt = ttlMinutes
    ? new Date(Date.now() + ttlMinutes * 60 * 1000)
    : undefined;

  // 5. Resolve cluster — explicit or auto-select first active
  let clusterId = data.clusterId;
  if (clusterId) {
    // Validate explicit cluster exists — try by ID first, then by slug
    let [cl] = await db
      .select({ clusterId: cluster.clusterId })
      .from(cluster)
      .where(eq(cluster.clusterId, clusterId))
      .limit(1);
    if (!cl) {
      [cl] = await db
        .select({ clusterId: cluster.clusterId })
        .from(cluster)
        .where(eq(cluster.slug, clusterId))
        .limit(1);
    }
    if (!cl) throw new Error(`Cluster not found: ${clusterId}`);
    clusterId = cl.clusterId;
  } else if (runtimeType === "container") {
    // Auto-select first active cluster (null if none available)
    const [firstCluster] = await db
      .select({ clusterId: cluster.clusterId })
      .from(cluster)
      .where(eq(cluster.status, "ready"))
      .limit(1);
    clusterId = firstCluster?.clusterId;
  }

  // 6. Create deployment target
  const [dt] = await db
    .insert(deploymentTarget)
    .values({
      name: data.name,
      slug: dtSlug,
      kind: "sandbox",
      runtime: runtimeType === "vm" ? "process" : "kubernetes",
      createdBy: data.ownerId,
      trigger: data.trigger ?? "manual",
      ttl: ttlMinutes ? `${ttlMinutes}m` : undefined,
      expiresAt,
      status: "provisioning",
      clusterId,
    })
    .returning();

  // 7. Create sandbox row
  const [sbx] = await db
    .insert(sandbox)
    .values({
      deploymentTargetId: dt!.deploymentTargetId,
      name: data.name,
      slug,
      runtimeType,
      devcontainerConfig: data.devcontainerConfig ?? {},
      devcontainerImage,
      ownerId: data.ownerId,
      ownerType: data.ownerType,
      repos: data.repos ?? [],
      cpu: data.cpu ?? template?.defaultCpu ?? undefined,
      memory: data.memory ?? template?.defaultMemory ?? undefined,
      storageGb:
        data.storageGb ?? template?.defaultStorageGb ?? 10,
      dockerCacheGb:
        data.dockerCacheGb ??
        template?.defaultDockerCacheGb ??
        20,
    })
    .returning();

  // Access control is now handled by auth-service resource permissions

  return sbx!;
}

export async function getSandbox(db: Database, sandboxId: string) {
  const rows = await db
    .select({
      sandbox,
      status: deploymentTarget.status,
      expiresAt: deploymentTarget.expiresAt,
    })
    .from(sandbox)
    .innerJoin(
      deploymentTarget,
      eq(sandbox.deploymentTargetId, deploymentTarget.deploymentTargetId)
    )
    .where(eq(sandbox.sandboxId, sandboxId));

  const row = rows[0];
  if (!row) return null;
  return { ...row.sandbox, status: row.status, expiresAt: row.expiresAt };
}

export async function listSandboxes(
  db: Database,
  filters?: {
    ownerId?: string;
    ownerType?: string;
    runtimeType?: string;
    status?: string;
  }
) {
  let query = db
    .select({
      sandbox,
      status: deploymentTarget.status,
      expiresAt: deploymentTarget.expiresAt,
    })
    .from(sandbox)
    .innerJoin(
      deploymentTarget,
      eq(sandbox.deploymentTargetId, deploymentTarget.deploymentTargetId)
    );

  if (filters?.ownerId) {
    query = query.where(eq(sandbox.ownerId, filters.ownerId)) as typeof query;
  }
  if (filters?.ownerType) {
    query = query.where(
      eq(sandbox.ownerType, filters.ownerType)
    ) as typeof query;
  }
  if (filters?.runtimeType) {
    query = query.where(
      eq(sandbox.runtimeType, filters.runtimeType)
    ) as typeof query;
  }
  if (filters?.status) {
    query = query.where(
      eq(deploymentTarget.status, filters.status)
    ) as typeof query;
  }

  const rows = await query;
  return rows.map((r) => ({
    ...r.sandbox,
    status: r.status,
    expiresAt: r.expiresAt,
  }));
}

export async function deleteSandbox(db: Database, sandboxId: string) {
  const row = await getSandbox(db, sandboxId);
  if (!row) throw new Error(`Sandbox not found: ${sandboxId}`);

  await db
    .update(deploymentTarget)
    .set({ status: "destroying" })
    .where(eq(deploymentTarget.deploymentTargetId, row.deploymentTargetId));
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function startSandbox(db: Database, sandboxId: string) {
  const row = await getSandbox(db, sandboxId);
  if (!row) throw new Error(`Sandbox not found: ${sandboxId}`);

  await db
    .update(deploymentTarget)
    .set({ status: "active" })
    .where(eq(deploymentTarget.deploymentTargetId, row.deploymentTargetId));

  return (await getSandbox(db, sandboxId))!;
}

export async function stopSandbox(db: Database, sandboxId: string) {
  const row = await getSandbox(db, sandboxId);
  if (!row) throw new Error(`Sandbox not found: ${sandboxId}`);

  await db
    .update(deploymentTarget)
    .set({ status: "suspended" })
    .where(eq(deploymentTarget.deploymentTargetId, row.deploymentTargetId));

  return (await getSandbox(db, sandboxId))!;
}

export async function resizeSandbox(
  db: Database,
  sandboxId: string,
  spec: { cpu?: string; memory?: string; storageGb?: number }
) {
  const rows = await db
    .update(sandbox)
    .set({ ...spec, updatedAt: new Date() })
    .where(eq(sandbox.sandboxId, sandboxId))
    .returning();
  if (!rows[0]) throw new Error(`Sandbox not found: ${sandboxId}`);
  return rows[0];
}

export async function extendSandbox(
  db: Database,
  sandboxId: string,
  additionalMinutes: number
) {
  const row = await getSandbox(db, sandboxId);
  if (!row) throw new Error(`Sandbox not found: ${sandboxId}`);

  const base = row.expiresAt ? new Date(row.expiresAt) : new Date();
  const newExpires = new Date(base.getTime() + additionalMinutes * 60 * 1000);

  await db
    .update(deploymentTarget)
    .set({ expiresAt: newExpires })
    .where(eq(deploymentTarget.deploymentTargetId, row.deploymentTargetId));

  return (await getSandbox(db, sandboxId))!;
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export async function snapshotSandbox(
  db: Database,
  sandboxId: string,
  data: { name: string; description?: string }
) {
  const sbx = await getSandbox(db, sandboxId);
  if (!sbx) throw new Error(`Sandbox not found: ${sandboxId}`);

  const [snap] = await db
    .insert(sandboxSnapshot)
    .values({
      sandboxId,
      name: data.name,
      description: data.description,
      runtimeType: sbx.runtimeType,
      snapshotMetadata: {
        devcontainerConfig: sbx.devcontainerConfig,
        devcontainerImage: sbx.devcontainerImage,
        repos: sbx.repos,
        cpu: sbx.cpu,
        memory: sbx.memory,
        storageGb: sbx.storageGb,
        dockerCacheGb: sbx.dockerCacheGb,
      },
      status: "creating",
    })
    .returning();

  return snap!;
}

export async function listSnapshots(db: Database, sandboxId: string) {
  return db
    .select()
    .from(sandboxSnapshot)
    .where(eq(sandboxSnapshot.sandboxId, sandboxId));
}

export async function getSnapshot(db: Database, snapshotId: string) {
  const rows = await db
    .select()
    .from(sandboxSnapshot)
    .where(eq(sandboxSnapshot.sandboxSnapshotId, snapshotId));
  return rows[0] ?? null;
}

export async function deleteSnapshot(db: Database, snapshotId: string) {
  await db
    .update(sandboxSnapshot)
    .set({ status: "deleted" })
    .where(eq(sandboxSnapshot.sandboxSnapshotId, snapshotId));
}

export async function updateSnapshotStatus(
  db: Database,
  snapshotId: string,
  status: "ready" | "failed",
  extra?: { sizeBytes?: string; volumeSnapshotName?: string }
) {
  await db
    .update(sandboxSnapshot)
    .set({
      status,
      ...(extra?.sizeBytes ? { sizeBytes: extra.sizeBytes } : {}),
      ...(extra?.volumeSnapshotName ? { volumeSnapshotName: extra.volumeSnapshotName } : {}),
    })
    .where(eq(sandboxSnapshot.sandboxSnapshotId, snapshotId));
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

export async function restoreSandbox(
  db: Database,
  sandboxId: string,
  snapshotId: string
) {
  const snap = await getSnapshot(db, snapshotId);
  if (!snap) throw new Error(`Snapshot not found: ${snapshotId}`);

  const meta = snap.snapshotMetadata as Record<string, any>;

  const rows = await db
    .update(sandbox)
    .set({
      devcontainerConfig: meta.devcontainerConfig ?? {},
      devcontainerImage: meta.devcontainerImage ?? undefined,
      repos: meta.repos ?? [],
      cpu: meta.cpu ?? undefined,
      memory: meta.memory ?? undefined,
      storageGb: meta.storageGb ?? 10,
      dockerCacheGb: meta.dockerCacheGb ?? 20,
      updatedAt: new Date(),
    })
    .where(eq(sandbox.sandboxId, sandboxId))
    .returning();

  if (!rows[0]) throw new Error(`Sandbox not found: ${sandboxId}`);
  return rows[0];
}

// ---------------------------------------------------------------------------
// Clone
// ---------------------------------------------------------------------------

export async function cloneSandbox(
  db: Database,
  snapshotId: string,
  data: { name: string; ownerId: string; ownerType: "user" | "agent" }
) {
  const snap = await getSnapshot(db, snapshotId);
  if (!snap) throw new Error(`Snapshot not found: ${snapshotId}`);

  const meta = snap.snapshotMetadata as Record<string, any>;

  const sbx = await createSandbox(db, {
    name: data.name,
    ownerId: data.ownerId,
    ownerType: data.ownerType,
    runtimeType: snap.runtimeType as "container" | "vm",
    devcontainerConfig: meta.devcontainerConfig,
    devcontainerImage: meta.devcontainerImage,
    repos: meta.repos,
    cpu: meta.cpu,
    memory: meta.memory,
    storageGb: meta.storageGb,
    dockerCacheGb: meta.dockerCacheGb,
  });

  // Set clonedFromSnapshotId
  const [updated] = await db
    .update(sandbox)
    .set({ clonedFromSnapshotId: snapshotId, updatedAt: new Date() })
    .where(eq(sandbox.sandboxId, sbx.sandboxId))
    .returning();

  return updated!;
}

// ---------------------------------------------------------------------------
// TTL
// ---------------------------------------------------------------------------

export async function expireStale(db: Database): Promise<number> {
  const now = new Date();

  const expired = await db
    .update(deploymentTarget)
    .set({ status: "destroying" })
    .where(
      and(
        eq(deploymentTarget.kind, "sandbox"),
        eq(deploymentTarget.status, "active"),
        lt(deploymentTarget.expiresAt, now)
      )
    )
    .returning();

  return expired.length;
}
