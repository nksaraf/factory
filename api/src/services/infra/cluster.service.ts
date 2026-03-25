import { eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { allocateSlug } from "../../lib/slug";
import { cluster } from "../../db/schema/infra";

export async function listClusters(
  db: Database,
  filters?: { providerId?: string; status?: string }
) {
  let query = db.select().from(cluster);
  if (filters?.providerId) {
    query = query.where(eq(cluster.providerId, filters.providerId)) as typeof query;
  }
  if (filters?.status) {
    query = query.where(eq(cluster.status, filters.status)) as typeof query;
  }
  return query;
}

export async function getCluster(db: Database, id: string) {
  const rows = await db
    .select()
    .from(cluster)
    .where(eq(cluster.clusterId, id));
  return rows[0] ?? null;
}

export async function createCluster(
  db: Database,
  data: {
    name: string;
    slug?: string;
    providerId: string;
    kubeconfigRef?: string;
  }
) {
  const { slug: explicitSlug, ...rest } = data;
  const slug = await allocateSlug({
    baseLabel: data.name,
    explicitSlug,
    isTaken: async (s) => {
      const [r] = await db
        .select()
        .from(cluster)
        .where(eq(cluster.slug, s))
        .limit(1);
      return r != null;
    },
  });
  const rows = await db.insert(cluster).values({ ...rest, slug }).returning();
  return rows[0];
}

export async function updateClusterStatus(
  db: Database,
  id: string,
  status: string
) {
  const rows = await db
    .update(cluster)
    .set({ status })
    .where(eq(cluster.clusterId, id))
    .returning();
  return rows[0] ?? null;
}

export async function destroyCluster(db: Database, id: string) {
  return updateClusterStatus(db, id, "destroying");
}

export async function getKubeconfig(db: Database, id: string) {
  const row = await getCluster(db, id);
  return row?.kubeconfigRef ?? null;
}
