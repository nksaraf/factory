import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { componentDeployment, systemDeployment } from "../../db/schema/ops";
import { allocateSlug } from "../../lib/slug";
import { parseTtlToMs } from "./utils";

// ---------------------------------------------------------------------------
// System Deployment CRUD (was Deployment Target)
// v2: deploymentTarget → systemDeployment in ops schema
// ---------------------------------------------------------------------------

export async function listSystemDeployments(
  db: Database,
  opts?: { type?: string; status?: string; siteId?: string },
) {
  const conditions = [];
  if (opts?.type) conditions.push(eq(systemDeployment.type, opts.type));
  if (opts?.siteId) conditions.push(eq(systemDeployment.siteId, opts.siteId));

  const base = db.select().from(systemDeployment);
  const rows =
    conditions.length > 0
      ? await base.where(and(...conditions)).orderBy(desc(systemDeployment.createdAt))
      : await base.orderBy(desc(systemDeployment.createdAt));

  let filtered = rows;
  if (opts?.status) {
    filtered = filtered.filter((r) => (r.spec as any)?.status === opts.status);
  }
  return { data: filtered, total: filtered.length };
}

/** @deprecated Use listSystemDeployments */
export const listDeploymentTargets = listSystemDeployments;

export async function createSystemDeployment(
  db: Database,
  input: {
    name: string;
    type: string;
    systemId: string;
    siteId: string;
    namespace?: string;
    createdBy: string;
    trigger: string;
    ttl?: string;
    labels?: Record<string, unknown>;
    runtime?: string;
    hostId?: string;
    vmId?: string;
  },
) {
  const slug = await allocateSlug({
    baseLabel: input.name,
    isTaken: async (s) => {
      const [existing] = await db
        .select({ id: systemDeployment.id })
        .from(systemDeployment)
        .where(eq(systemDeployment.slug, s))
        .limit(1);
      return !!existing;
    },
  });

  const expiresAt = input.ttl
    ? new Date(Date.now() + parseTtlToMs(input.ttl))
    : undefined;

  const [row] = await db
    .insert(systemDeployment)
    .values({
      name: input.name,
      slug,
      type: input.type,
      systemId: input.systemId,
      siteId: input.siteId,
      spec: {
        trigger: input.trigger,
        createdBy: input.createdBy,
        status: "provisioning",
        namespace: input.namespace,
        ttl: input.ttl,
        expiresAt: expiresAt?.toISOString(),
        labels: input.labels ?? {},
        runtime: input.runtime ?? "kubernetes",
        hostId: input.hostId ?? null,
        vmId: input.vmId ?? null,
      } as any,
    })
    .returning();

  return row;
}

/** @deprecated Use createSystemDeployment */
export const createDeploymentTarget = createSystemDeployment;

export async function getSystemDeployment(db: Database, id: string) {
  const [row] = await db
    .select()
    .from(systemDeployment)
    .where(eq(systemDeployment.id, id))
    .limit(1);

  if (!row) return null;

  const components = await db
    .select()
    .from(componentDeployment)
    .where(eq(componentDeployment.systemDeploymentId, id));

  return {
    ...row,
    deploymentTargetId: row.id,
    workloads: components,
    componentDeployments: components,
  };
}

/** @deprecated Use getSystemDeployment */
export const getDeploymentTarget = getSystemDeployment;

export async function updateSystemDeploymentStatus(
  db: Database,
  id: string,
  status: string,
) {
  const [existing] = await db
    .select()
    .from(systemDeployment)
    .where(eq(systemDeployment.id, id))
    .limit(1);

  if (!existing) throw new Error(`System deployment not found: ${id}`);

  const [updated] = await db
    .update(systemDeployment)
    .set({ spec: { ...(existing.spec as any), status } as any })
    .where(eq(systemDeployment.id, id))
    .returning();

  return updated;
}

/** @deprecated Use updateSystemDeploymentStatus */
export const updateDeploymentTargetStatus = updateSystemDeploymentStatus;

export async function destroySystemDeployment(db: Database, id: string) {
  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(systemDeployment)
      .where(eq(systemDeployment.id, id))
      .limit(1);

    if (!existing) throw new Error(`System deployment not found: ${id}`);

    const [updated] = await tx
      .update(systemDeployment)
      .set({
        spec: {
          ...(existing.spec as any),
          status: "destroying",
          destroyedAt: new Date().toISOString(),
        } as any,
      })
      .where(eq(systemDeployment.id, id))
      .returning();

    const components = await tx
      .select()
      .from(componentDeployment)
      .where(eq(componentDeployment.systemDeploymentId, id));

    for (const c of components) {
      await tx
        .update(componentDeployment)
        .set({
          spec: { ...(c.spec as any), status: "stopped" } as any,
          updatedAt: new Date(),
        })
        .where(eq(componentDeployment.id, c.id));
    }

    return updated;
  });
}

/** @deprecated Use destroySystemDeployment */
export const destroyDeploymentTarget = destroySystemDeployment;

// ---------------------------------------------------------------------------
// Dependency Workloads — v2: stored in systemDeployment.spec.dependencies
// ---------------------------------------------------------------------------

export async function listDependencyWorkloads(db: Database, systemDeploymentId: string) {
  const [row] = await db
    .select()
    .from(systemDeployment)
    .where(eq(systemDeployment.id, systemDeploymentId))
    .limit(1);

  const deps = (row?.spec as any)?.dependencies ?? [];
  return { data: deps, total: deps.length };
}

export async function createDependencyWorkload(
  db: Database,
  input: {
    deploymentTargetId: string;
    name: string;
    image: string;
    port: number;
    env?: Record<string, unknown>;
  },
) {
  const [row] = await db
    .select()
    .from(systemDeployment)
    .where(eq(systemDeployment.id, input.deploymentTargetId))
    .limit(1);

  if (!row) throw new Error(`System deployment not found: ${input.deploymentTargetId}`);

  const slug = await allocateSlug({
    baseLabel: input.name,
    isTaken: async (s) =>
      ((row.spec as any)?.dependencies ?? []).some((d: any) => d.slug === s),
  });

  const dep = {
    name: input.name,
    slug,
    image: input.image,
    port: input.port,
    env: input.env ?? {},
    status: "pending",
  };

  const deps = [...((row.spec as any)?.dependencies ?? []), dep];
  await db
    .update(systemDeployment)
    .set({ spec: { ...(row.spec as any), dependencies: deps } as any })
    .where(eq(systemDeployment.id, row.id));

  return dep;
}

export async function updateDependencyWorkloadStatus(
  db: Database,
  systemDeploymentId: string,
  depName: string,
  status: string,
) {
  const [row] = await db
    .select()
    .from(systemDeployment)
    .where(eq(systemDeployment.id, systemDeploymentId))
    .limit(1);

  if (!row) throw new Error(`System deployment not found: ${systemDeploymentId}`);

  const deps = ((row.spec as any)?.dependencies ?? []).map((d: any) =>
    d.name === depName ? { ...d, status } : d,
  );

  const [updated] = await db
    .update(systemDeployment)
    .set({ spec: { ...(row.spec as any), dependencies: deps } as any })
    .where(eq(systemDeployment.id, row.id))
    .returning();

  return updated;
}
