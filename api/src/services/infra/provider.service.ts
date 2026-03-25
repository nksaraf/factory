import { eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { allocateSlug } from "../../lib/slug";
import { provider } from "../../db/schema/infra";
import { getProviderAdapter } from "../../adapters/adapter-registry";
import type { Provider, ProviderType } from "@smp/factory-shared/types";

export async function listProviders(
  db: Database,
  filters?: { status?: string }
) {
  let query = db.select().from(provider);
  if (filters?.status) {
    query = query.where(eq(provider.status, filters.status)) as typeof query;
  }
  return query;
}

export async function getProvider(db: Database, id: string) {
  const rows = await db
    .select()
    .from(provider)
    .where(eq(provider.providerId, id));
  return rows[0] ?? null;
}

export async function createProvider(
  db: Database,
  data: {
    name: string;
    slug?: string;
    providerType: string;
    url?: string;
    credentialsRef?: string;
    providerKind?: string;
  }
) {
  const { slug: explicitSlug, ...rest } = data;
  const slug = await allocateSlug({
    baseLabel: data.name,
    explicitSlug,
    isTaken: async (s) => {
      const [r] = await db
        .select()
        .from(provider)
        .where(eq(provider.slug, s))
        .limit(1);
      return r != null;
    },
  });
  const rows = await db.insert(provider).values({ ...rest, slug }).returning();
  return rows[0];
}

export async function updateProvider(
  db: Database,
  id: string,
  patch: { name?: string; status?: string; url?: string; credentialsRef?: string }
) {
  const rows = await db
    .update(provider)
    .set(patch)
    .where(eq(provider.providerId, id))
    .returning();
  return rows[0] ?? null;
}

export async function syncProvider(db: Database, id: string) {
  const row = await getProvider(db, id);
  if (!row) throw new Error(`Provider not found: ${id}`);
  const adapter = getProviderAdapter(row.providerType as ProviderType, db);
  return adapter.syncInventory(row as unknown as Provider, db);
}
