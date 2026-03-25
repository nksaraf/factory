import { eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { allocateSlug } from "../../lib/slug";
import { proxmoxCluster } from "../../db/schema/infra";

export async function listProxmoxClusters(
  db: Database,
  filters?: { providerId?: string }
) {
  let query = db.select().from(proxmoxCluster);
  if (filters?.providerId) {
    query = query.where(
      eq(proxmoxCluster.providerId, filters.providerId)
    ) as typeof query;
  }
  return query;
}

export async function getProxmoxCluster(db: Database, id: string) {
  const rows = await db
    .select()
    .from(proxmoxCluster)
    .where(eq(proxmoxCluster.proxmoxClusterId, id));
  return rows[0] ?? null;
}

export async function createProxmoxCluster(
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
        .from(proxmoxCluster)
        .where(eq(proxmoxCluster.slug, s))
        .limit(1);
      return r != null;
    },
  });
  const rows = await db
    .insert(proxmoxCluster)
    .values({ ...rest, slug })
    .returning();
  return rows[0];
}

export async function updateProxmoxCluster(
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
    .update(proxmoxCluster)
    .set(patch)
    .where(eq(proxmoxCluster.proxmoxClusterId, id))
    .returning();
  return rows[0] ?? null;
}

export async function deleteProxmoxCluster(db: Database, id: string) {
  const rows = await db
    .delete(proxmoxCluster)
    .where(eq(proxmoxCluster.proxmoxClusterId, id))
    .returning();
  return rows[0] ?? null;
}
