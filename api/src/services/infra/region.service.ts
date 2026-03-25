import { eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { allocateSlug } from "../../lib/slug";
import { region } from "../../db/schema/infra";

export async function listRegions(
  db: Database,
  filters?: { providerId?: string }
) {
  let query = db.select().from(region);
  if (filters?.providerId) {
    query = query.where(eq(region.providerId, filters.providerId)) as typeof query;
  }
  return query;
}

export async function getRegion(db: Database, id: string) {
  const rows = await db
    .select()
    .from(region)
    .where(eq(region.regionId, id));
  return rows[0] ?? null;
}

export async function createRegion(
  db: Database,
  data: {
    name: string;
    displayName: string;
    slug?: string;
    country?: string;
    city?: string;
    timezone?: string;
    providerId?: string;
  }
) {
  const { slug: explicitSlug, ...rest } = data;
  const baseLabel =
    data.displayName.trim() || data.name.trim() || data.displayName;
  const slug = await allocateSlug({
    baseLabel,
    explicitSlug,
    isTaken: async (s) => {
      const [r] = await db
        .select()
        .from(region)
        .where(eq(region.slug, s))
        .limit(1);
      return r != null;
    },
  });
  const rows = await db.insert(region).values({ ...rest, slug }).returning();
  return rows[0];
}

export async function updateRegion(
  db: Database,
  id: string,
  patch: { name?: string; displayName?: string; country?: string; city?: string; timezone?: string }
) {
  const rows = await db
    .update(region)
    .set(patch)
    .where(eq(region.regionId, id))
    .returning();
  return rows[0] ?? null;
}

export async function deleteRegion(db: Database, id: string) {
  const rows = await db
    .delete(region)
    .where(eq(region.regionId, id))
    .returning();
  return rows[0] ?? null;
}
