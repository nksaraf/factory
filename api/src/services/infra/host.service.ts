import { eq, count } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { allocateSlug } from "../../lib/slug";
import { host, vm } from "../../db/schema/infra";

export async function listHosts(
  db: Database,
  filters?: { slug?: string; providerId?: string; datacenterId?: string; status?: string; osType?: string }
) {
  let query = db.select().from(host);
  if (filters?.slug) {
    query = query.where(eq(host.slug, filters.slug)) as typeof query;
  }
  if (filters?.providerId) {
    query = query.where(eq(host.providerId, filters.providerId)) as typeof query;
  }
  if (filters?.datacenterId) {
    query = query.where(eq(host.datacenterId, filters.datacenterId)) as typeof query;
  }
  if (filters?.status) {
    query = query.where(eq(host.status, filters.status)) as typeof query;
  }
  if (filters?.osType) {
    query = query.where(eq(host.osType, filters.osType)) as typeof query;
  }
  return query;
}

export async function getHost(db: Database, id: string) {
  const rows = await db
    .select()
    .from(host)
    .where(eq(host.hostId, id));
  const row = rows[0] ?? null;
  if (!row) return null;

  const vmCountRows = await db
    .select({ count: count() })
    .from(vm)
    .where(eq(vm.hostId, id));
  const vmCount = vmCountRows[0]?.count ?? 0;

  return { ...row, vmCount };
}

export async function addHost(
  db: Database,
  data: {
    name: string;
    slug?: string;
    hostname?: string;
    providerId: string;
    datacenterId?: string;
    ipAddress?: string;
    ipmiAddress?: string;
    cpuCores: number;
    memoryMb: number;
    diskGb: number;
    rackLocation?: string;
    osType?: string;
    accessMethod?: string;
  }
) {
  const { slug: explicitSlug, ...rest } = data;
  const slug = await allocateSlug({
    baseLabel: data.name,
    explicitSlug,
    isTaken: async (s) => {
      const [r] = await db
        .select()
        .from(host)
        .where(eq(host.slug, s))
        .limit(1);
      return r != null;
    },
  });
  const rows = await db.insert(host).values({ ...rest, slug }).returning();
  return rows[0];
}

export async function removeHost(db: Database, id: string) {
  const rows = await db
    .delete(host)
    .where(eq(host.hostId, id))
    .returning();
  return rows[0] ?? null;
}

export async function updateHostStatus(
  db: Database,
  id: string,
  status: string
) {
  const rows = await db
    .update(host)
    .set({ status })
    .where(eq(host.hostId, id))
    .returning();
  return rows[0] ?? null;
}
