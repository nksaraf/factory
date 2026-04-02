import { eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { allocateSlug } from "../../lib/slug";
import { vmCluster } from "../../db/schema/infra";

export async function listVmClusters(
  db: Database,
  filters?: { providerId?: string }
) {
  let query = db.select().from(vmCluster);
  if (filters?.providerId) {
    query = query.where(
      eq(vmCluster.providerId, filters.providerId)
    ) as typeof query;
  }
  return query;
}

export async function getVmCluster(db: Database, id: string) {
  const rows = await db
    .select()
    .from(vmCluster)
    .where(eq(vmCluster.vmClusterId, id));
  return rows[0] ?? null;
}

export async function createVmCluster(
  db: Database,
  data: {
    name: string;
    slug?: string;
    providerId: string;
    apiHost: string;
    apiPort?: number;
    tokenId?: string;
    tokenSecret?: string;
    sslFingerprint?: string;
  }
) {
  const { slug: explicitSlug, ...rest } = data;
  const slug = await allocateSlug({
    baseLabel: data.name,
    explicitSlug,
    isTaken: async (s) => {
      const [r] = await db
        .select()
        .from(vmCluster)
        .where(eq(vmCluster.slug, s))
        .limit(1);
      return r != null;
    },
  });
  const rows = await db
    .insert(vmCluster)
    .values({ ...rest, slug })
    .returning();
  return rows[0];
}

export async function updateVmCluster(
  db: Database,
  id: string,
  patch: {
    name?: string;
    apiHost?: string;
    apiPort?: number;
    tokenId?: string;
    tokenSecret?: string;
    sslFingerprint?: string;
  }
) {
  const rows = await db
    .update(vmCluster)
    .set(patch)
    .where(eq(vmCluster.vmClusterId, id))
    .returning();
  return rows[0] ?? null;
}

export async function deleteVmCluster(db: Database, id: string) {
  const rows = await db
    .delete(vmCluster)
    .where(eq(vmCluster.vmClusterId, id))
    .returning();
  return rows[0] ?? null;
}
