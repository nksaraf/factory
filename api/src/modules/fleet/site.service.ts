import { and, count, desc, eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { site, systemDeployment } from "../../db/schema/ops";
import { allocateSlug } from "../../lib/slug";

// ---------------------------------------------------------------------------
// Site CRUD — v2: ops schema; product, status → spec JSONB
// ---------------------------------------------------------------------------

const VALID_SITE_STATUSES = ["provisioning", "active", "suspended", "decommissioned"] as const;

export async function listSites(
  db: Database,
  opts?: { product?: string; status?: string },
) {
  const rows = await db.select().from(site).orderBy(desc(site.createdAt));
  let filtered = rows;
  if (opts?.product) filtered = filtered.filter((r) => (r.spec as any)?.product === opts.product);
  if (opts?.status) filtered = filtered.filter((r) => (r.spec as any)?.status === opts.status);
  return { data: filtered, total: filtered.length };
}

export async function createSite(
  db: Database,
  input: { name: string; product: string; clusterId?: string; createdBy: string },
) {
  const slug = await allocateSlug({
    baseLabel: input.name,
    isTaken: async (s) => {
      const [existing] = await db
        .select({ id: site.id })
        .from(site)
        .where(eq(site.slug, s))
        .limit(1);
      return !!existing;
    },
  });

  const [row] = await db
    .insert(site)
    .values({
      name: input.name,
      slug,
      spec: {
        product: input.product,
        status: "provisioning",
        clusterId: input.clusterId,
        createdBy: input.createdBy,
      } as any,
    })
    .returning();

  return row;
}

export async function getSite(db: Database, name: string) {
  const [row] = await db.select().from(site).where(eq(site.slug, name)).limit(1);
  if (!row) return null;

  const [targetCount] = await db
    .select({ count: count() })
    .from(systemDeployment)
    .where(eq(systemDeployment.siteId, row.id));

  return {
    ...row,
    siteId: row.id,
    product: (row.spec as any)?.product,
    status: (row.spec as any)?.status,
    deploymentTargetCount: targetCount?.count ?? 0,
    systemDeploymentCount: targetCount?.count ?? 0,
  };
}

export async function deleteSite(db: Database, name: string) {
  return await db.transaction(async (tx) => {
    const [row] = await tx.select().from(site).where(eq(site.slug, name)).limit(1);
    if (!row) throw new Error(`Site not found: ${name}`);

    const deployments = await tx
      .select()
      .from(systemDeployment)
      .where(eq(systemDeployment.siteId, row.id));

    for (const d of deployments) {
      await tx
        .update(systemDeployment)
        .set({ spec: { ...(d.spec as any), status: "destroying" } as any })
        .where(eq(systemDeployment.id, d.id));
    }

    const [updated] = await tx
      .update(site)
      .set({ spec: { ...(row.spec as any), status: "decommissioned" } as any })
      .where(eq(site.id, row.id))
      .returning();

    return updated;
  });
}

export async function updateSiteStatus(db: Database, name: string, status: string) {
  if (!VALID_SITE_STATUSES.includes(status as (typeof VALID_SITE_STATUSES)[number])) {
    throw new Error(
      `Invalid site status '${status}'. Must be one of: ${VALID_SITE_STATUSES.join(", ")}`,
    );
  }

  const [row] = await db.select().from(site).where(eq(site.slug, name)).limit(1);
  if (!row) throw new Error(`Site not found: ${name}`);

  const [updated] = await db
    .update(site)
    .set({ spec: { ...(row.spec as any), status } as any })
    .where(eq(site.id, row.id))
    .returning();

  return updated;
}

// ---------------------------------------------------------------------------
// Tenant Assignment
// ---------------------------------------------------------------------------

export async function assignTenant(_db: Database, siteName: string, tenantId: string) {
  return {
    ok: true,
    site: siteName,
    tenantId,
    note: "Tenant assignment acknowledged. Full tenant model deferred to Commerce Plane.",
  };
}
