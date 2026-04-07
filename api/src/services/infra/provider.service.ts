import { eq, sql } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { allocateSlug } from "../../lib/slug";
import { substrate } from "../../db/schema/infra-v2";
import { getVMProviderAdapter } from "../../adapters/adapter-registry";
import type { VmProviderType } from "../../adapters/vm-provider-adapter";

export async function listProviders(
  db: Database,
  filters?: { lifecycle?: string }
) {
  let query = db.select().from(substrate);
  if (filters?.lifecycle) {
    query = query.where(sql`${substrate.spec}->>'lifecycle' = ${filters.lifecycle}`) as typeof query;
  }
  return query;
}

export async function getProvider(db: Database, id: string) {
  const rows = await db
    .select()
    .from(substrate)
    .where(eq(substrate.id, id));
  return rows[0] ?? null;
}

export async function createProvider(
  db: Database,
  data: {
    name: string;
    slug?: string;
    type: string;
    parentSubstrateId?: string;
    spec?: Record<string, unknown>;
  }
) {
  const { slug: explicitSlug, ...rest } = data;
  const slug = await allocateSlug({
    baseLabel: data.name,
    explicitSlug,
    isTaken: async (s) => {
      const [r] = await db
        .select()
        .from(substrate)
        .where(eq(substrate.slug, s))
        .limit(1);
      return r != null;
    },
  });
  const rows = await db.insert(substrate).values({ ...rest, slug, spec: data.spec ?? {} } as any).returning();
  return rows[0];
}

export async function syncProvider(db: Database, id: string) {
  const row = await getProvider(db, id);
  if (!row) throw new Error(`Substrate not found: ${id}`);

  const spec = (row.spec ?? {}) as Record<string, unknown>;
  const providerKind = spec.providerKind as string | undefined;
  if (!providerKind) throw new Error(`Substrate ${id} has no providerKind in spec`);

  const adapter = getVMProviderAdapter(providerKind as VmProviderType, db);
  return adapter.syncInventory(row);
}
