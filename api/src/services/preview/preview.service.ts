import { eq, and, lt } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { preview, deploymentTarget } from "../../db/schema/fleet";
import { route } from "../../db/schema/gateway";
import { createRoute, updateRoute } from "../../modules/infra/gateway.service";

function buildPreviewSlug(input: { prNumber?: number; sourceBranch: string; siteName: string }): string {
  const branch = input.sourceBranch
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const site = input.siteName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (input.prNumber != null) {
    return `pr-${input.prNumber}--${branch}--${site}`;
  }
  return `${branch}--${site}`;
}

export async function createPreview(
  db: Database,
  input: {
    name: string;
    sourceBranch: string;
    commitSha: string;
    repo: string;
    prNumber?: number;
    siteName: string;
    siteId?: string;
    clusterId?: string;
    ownerId: string;
    createdBy: string;
    authMode?: string;
    expiresAt?: Date;
  }
): Promise<{ preview: any; deploymentTarget: any; route: any }> {
  const slug = buildPreviewSlug(input);

  // Layer 1: Create deploymentTarget
  const [dt] = await db
    .insert(deploymentTarget)
    .values({
      name: `preview-${slug}`,
      slug: `preview-${slug}`,
      kind: "preview",
      runtime: "kubernetes",
      siteId: input.siteId,
      clusterId: input.clusterId,
      createdBy: input.createdBy,
      trigger: "pr",
      expiresAt: input.expiresAt,
      status: "provisioning",
    })
    .returning();

  // Layer 2: Create preview record
  const [prev] = await db
    .insert(preview)
    .values({
      deploymentTargetId: dt.deploymentTargetId,
      siteId: input.siteId,
      name: input.name,
      slug,
      sourceBranch: input.sourceBranch,
      commitSha: input.commitSha,
      repo: input.repo,
      prNumber: input.prNumber ?? null,
      ownerId: input.ownerId,
      authMode: input.authMode ?? "team",
      status: "building",
    })
    .returning();

  // Layer 3: Create route
  const previewRoute = await createRoute(db, {
    deploymentTargetId: dt.deploymentTargetId,
    siteId: input.siteId,
    clusterId: input.clusterId,
    kind: "preview",
    domain: `${slug}.preview.dx.dev`,
    targetService: slug,
    protocol: "http",
    status: "active",
    createdBy: input.createdBy,
  });

  return { preview: prev, deploymentTarget: dt, route: previewRoute };
}

export async function getPreview(db: Database, previewId: string) {
  const [row] = await db
    .select()
    .from(preview)
    .where(eq(preview.previewId, previewId))
    .limit(1);
  return row ?? null;
}

export async function getPreviewBySlug(db: Database, slug: string) {
  const [row] = await db
    .select()
    .from(preview)
    .where(eq(preview.slug, slug))
    .limit(1);
  return row ?? null;
}

export async function updatePreviewStatus(
  db: Database,
  previewId: string,
  updates: {
    status?: string;
    runtimeClass?: string;
    statusMessage?: string;
    commitSha?: string;
    lastAccessedAt?: Date;
  }
) {
  const [row] = await db
    .update(preview)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(preview.previewId, previewId))
    .returning();
  return row ?? null;
}

export async function expirePreview(db: Database, previewId: string) {
  const prev = await getPreview(db, previewId);
  if (!prev) return null;

  await updatePreviewStatus(db, previewId, { status: "expired" });

  const routes = await db
    .select()
    .from(route)
    .where(eq(route.deploymentTargetId, prev.deploymentTargetId));

  for (const r of routes) {
    await updateRoute(db, r.routeId, { status: "expired" });
  }

  return await getPreview(db, previewId);
}

/**
 * Periodic cleanup job for preview lifecycle transitions.
 * Should be called every ~5 minutes.
 *
 * 1. active + expiresAt < now → expired
 * 2. active + hot + lastAccessedAt < 2h ago → warm
 * 3. active + warm + lastAccessedAt < 24h ago → cold
 * 4. expired + expiresAt < 30d ago → hard delete
 */
export async function runPreviewCleanup(db: Database): Promise<{
  expired: number;
  scaledToWarm: number;
  scaledToCold: number;
  deleted: number;
}> {
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // 1. Expire active previews past expiresAt
  const expiredRows = await db
    .update(preview)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(preview.status, "active"),
        lt(preview.expiresAt, now)
      )
    )
    .returning();

  // Also expire their routes
  for (const p of expiredRows) {
    const routes = await db
      .select()
      .from(route)
      .where(eq(route.deploymentTargetId, p.deploymentTargetId));
    for (const r of routes) {
      await updateRoute(db, r.routeId, { status: "expired" });
    }
  }

  // 2. Hot → Warm (idle > 2h)
  const warmRows = await db
    .update(preview)
    .set({ runtimeClass: "warm", updatedAt: now })
    .where(
      and(
        eq(preview.status, "active"),
        eq(preview.runtimeClass, "hot"),
        lt(preview.lastAccessedAt, twoHoursAgo)
      )
    )
    .returning();

  // 3. Warm → Cold (idle > 24h)
  const coldRows = await db
    .update(preview)
    .set({ runtimeClass: "cold", updatedAt: now })
    .where(
      and(
        eq(preview.status, "active"),
        eq(preview.runtimeClass, "warm"),
        lt(preview.lastAccessedAt, twentyFourHoursAgo)
      )
    )
    .returning();

  // 4. Hard delete expired previews older than 30 days
  const deletedRows = await db
    .delete(preview)
    .where(
      and(
        eq(preview.status, "expired"),
        lt(preview.expiresAt, thirtyDaysAgo)
      )
    )
    .returning();

  return {
    expired: expiredRows.length,
    scaledToWarm: warmRows.length,
    scaledToCold: coldRows.length,
    deleted: deletedRows.length,
  };
}

export async function listPreviews(
  db: Database,
  opts?: {
    siteId?: string;
    status?: string;
    sourceBranch?: string;
    repo?: string;
  }
) {
  const conditions = [];
  if (opts?.siteId) conditions.push(eq(preview.siteId, opts.siteId));
  if (opts?.status) conditions.push(eq(preview.status, opts.status));
  if (opts?.sourceBranch) conditions.push(eq(preview.sourceBranch, opts.sourceBranch));
  if (opts?.repo) conditions.push(eq(preview.repo, opts.repo));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const base = db.select().from(preview);
  return where ? await base.where(where) : await base;
}
