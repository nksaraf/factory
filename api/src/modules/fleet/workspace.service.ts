import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { workspace } from "../../db/schema/ops";
import { runtime } from "../../db/schema/infra-v2";
import { principal } from "../../db/schema/org-v2";
import { allocateSlug } from "../../lib/slug";
import { removeSystemDeploymentRoutes } from "../infra/gateway.service";
import { parseTtlToMs } from "./utils";

// ---------------------------------------------------------------------------
// Workspace CRUD — v2: ops schema
// ---------------------------------------------------------------------------

const DEFAULT_TTLS: Record<string, string> = {
  pr: "48h",
  agent: "2h",
  manual: "24h",
  ci: "4h",
};

function generateWorkspaceName(): string {
  return `workspace-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Resolve the default runtime (k8s cluster) for a workspace.
 * Priority: isDefault=true > status=ready > any k8s-cluster.
 * Returns null if no runtimes are registered.
 */
export async function resolveDefaultRuntime(
  db: Database,
): Promise<string | null> {
  const allRuntimes = await db
    .select({ id: runtime.id, spec: runtime.spec })
    .from(runtime)
    .where(eq(runtime.type, "k8s-cluster"));

  const defaultRuntime =
    allRuntimes.find((r) => (r.spec as any)?.isDefault === true) ??
    allRuntimes.find((r) => (r.spec as any)?.status === "ready") ??
    allRuntimes[0];

  return defaultRuntime?.id ?? null;
}

export async function listWorkspaces(
  db: Database,
  opts?: {
    ownerId?: string;
    type?: string;
    all?: boolean;
    createdBy?: string;
    trigger?: string;
  },
) {
  const conditions = [];
  if (opts?.ownerId) conditions.push(eq(workspace.ownerId, opts.ownerId));
  if (opts?.type) conditions.push(eq(workspace.type, opts.type));

  const base = db.select().from(workspace);
  const rows =
    conditions.length > 0
      ? await base.where(and(...conditions)).orderBy(desc(workspace.createdAt))
      : await base.orderBy(desc(workspace.createdAt));

  let filtered = rows;
  if (opts?.createdBy) {
    filtered = filtered.filter((r) => (r.spec as any)?.createdBy === opts.createdBy);
  }
  if (opts?.trigger) {
    filtered = filtered.filter((r) => (r.spec as any)?.trigger === opts.trigger);
  }
  if (!opts?.all) {
    filtered = filtered.filter(
      (r) => !["destroyed", "destroying"].includes((r.spec as any)?.lifecycle ?? ""),
    );
  }

  return { data: filtered, total: filtered.length };
}

/**
 * Create a workspace. Inserts a DB row with proper defaults and returns it.
 * The reconciler handles actual provisioning (namespace, routes, etc).
 */
export async function createWorkspace(
  db: Database,
  input: {
    name?: string;
    ownerId?: string;
    createdBy?: string;
    type?: string;
    ttl?: string;
    trigger?: string;
    labels?: Record<string, unknown>;
    dependencies?: Array<{
      name: string;
      image: string;
      port: number;
      env?: Record<string, unknown>;
    }>;
    publishPorts?: number[];
    snapshotId?: string;
    runtimeId?: string;
  },
) {
  const name = input.name ?? generateWorkspaceName();
  const trigger = input.trigger ?? "manual";
  const ttl = input.ttl ?? DEFAULT_TTLS[trigger] ?? "24h";
  const type = input.type ?? "developer";

  const slug = await allocateSlug({
    baseLabel: name,
    isTaken: async (s) => {
      const [existing] = await db
        .select({ id: workspace.id })
        .from(workspace)
        .where(eq(workspace.slug, s))
        .limit(1);
      return !!existing;
    },
  });

  const expiresAt = new Date(Date.now() + parseTtlToMs(ttl));

  // Auto-assign default runtime if none provided
  let runtimeId: string | null = input.runtimeId ?? null;
  if (!runtimeId) {
    runtimeId = await resolveDefaultRuntime(db);
  }
  if (!runtimeId) {
    throw new Error(
      "No cluster registered. Run `dx setup --role factory` to bootstrap a cluster.",
    );
  }

  // Auto-create principal if it doesn't exist (local dev convenience)
  if (input.ownerId) {
    const [existingPrincipal] = await db
      .select({ id: principal.id })
      .from(principal)
      .where(eq(principal.id, input.ownerId))
      .limit(1);
    if (!existingPrincipal) {
      await db.insert(principal).values({
        id: input.ownerId,
        slug: input.ownerId,
        name: input.ownerId,
        type: "human",
        spec: { status: "active" },
      } as any).onConflictDoNothing();
    }
  }

  const [ws] = await db
    .insert(workspace)
    .values({
      name,
      slug,
      type,
      runtimeId,
      ownerId: input.ownerId ?? null,
      spec: {
        trigger,
        createdBy: input.createdBy ?? input.ownerId ?? "system",
        lifecycle: "provisioning",
        runtimeType: "container",
        ttl,
        expiresAt: expiresAt.toISOString(),
        labels: input.labels ?? {},
        dependencies: input.dependencies ?? [],
      } as any,
    })
    .returning();

  return ws;
}

export async function destroyWorkspace(
  db: Database,
  id: string,
) {
  await removeSystemDeploymentRoutes(db, id);

  const [existing] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.id, id))
    .limit(1);

  if (!existing) throw new Error(`Workspace not found: ${id}`);

  const [updated] = await db
    .update(workspace)
    .set({
      spec: {
        ...(existing.spec as any),
        lifecycle: "destroying",
      } as any,
    })
    .where(eq(workspace.id, id))
    .returning();

  return updated;
}

export async function cleanupExpiredWorkspaces(db: Database) {
  const all = await db.select().from(workspace);
  const now = new Date();

  const expired = all.filter((w) => {
    const spec = w.spec as any;
    if (spec?.lifecycle !== "active") return false;
    const ea = spec?.expiresAt ? new Date(spec.expiresAt) : null;
    return ea && ea < now;
  });

  let cleaned = 0;
  for (const ws of expired) {
    await destroyWorkspace(db, ws.id);
    cleaned++;
  }

  return { cleaned };
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

export async function resizeWorkspace(
  db: Database,
  workspaceId: string,
  resize: { cpu?: string; memory?: string; storageGb?: number },
) {
  const [existing] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  if (!existing) throw new Error(`Workspace not found: ${workspaceId}`);

  const spec = (existing.spec ?? {}) as Record<string, any>;
  const [updated] = await db
    .update(workspace)
    .set({
      spec: {
        ...spec,
        ...(resize.cpu !== undefined ? { cpu: resize.cpu } : {}),
        ...(resize.memory !== undefined ? { memory: resize.memory } : {}),
        ...(resize.storageGb !== undefined ? { storageGb: resize.storageGb } : {}),
      } as any,
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, workspaceId))
    .returning();
  return updated!;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export async function updateWorkspaceHealth(
  db: Database,
  workspaceId: string,
  healthStatus: string,
  statusMessage?: string,
) {
  const [existing] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  if (!existing) return;

  const spec = (existing.spec ?? {}) as Record<string, any>;
  await db
    .update(workspace)
    .set({
      spec: {
        ...spec,
        healthStatus,
        healthCheckedAt: new Date().toISOString(),
        ...(statusMessage !== undefined ? { statusMessage } : {}),
      } as any,
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, workspaceId));
}

// ---------------------------------------------------------------------------
// TTL / Expiry
// ---------------------------------------------------------------------------

export async function expireStale(db: Database): Promise<number> {
  const now = new Date();
  const all = await db.select().from(workspace);

  const expired = all.filter((w) => {
    const spec = w.spec as any;
    if (spec?.lifecycle !== "active") return false;
    const ea = spec?.expiresAt ? new Date(spec.expiresAt) : null;
    return ea != null && ea < now;
  });

  for (const ws of expired) {
    const spec = (ws.spec ?? {}) as Record<string, any>;
    await db
      .update(workspace)
      .set({
        spec: { ...spec, lifecycle: "destroying" } as any,
        updatedAt: now,
      })
      .where(eq(workspace.id, ws.id));
  }

  return expired.length;
}
