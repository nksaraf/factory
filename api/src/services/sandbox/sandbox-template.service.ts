import { eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { allocateSlug } from "../../lib/slug";
import { sandboxTemplate } from "../../db/schema/fleet";

export async function listTemplates(
  db: Database,
  filters?: { runtimeType?: string }
) {
  let query = db.select().from(sandboxTemplate);
  if (filters?.runtimeType) {
    query = query.where(
      eq(sandboxTemplate.runtimeType, filters.runtimeType)
    ) as typeof query;
  }
  return query;
}

export async function getTemplate(db: Database, id: string) {
  const rows = await db
    .select()
    .from(sandboxTemplate)
    .where(eq(sandboxTemplate.sandboxTemplateId, id));
  return rows[0] ?? null;
}

export async function getTemplateBySlug(db: Database, slug: string) {
  const rows = await db
    .select()
    .from(sandboxTemplate)
    .where(eq(sandboxTemplate.slug, slug));
  return rows[0] ?? null;
}

export async function createTemplate(
  db: Database,
  data: {
    name: string;
    slug?: string;
    runtimeType: string;
    image?: string;
    defaultCpu?: string;
    defaultMemory?: string;
    defaultStorageGb?: number;
    defaultDockerCacheGb?: number;
    vmTemplateRef?: string;
    defaultTtlMinutes?: number;
    preInstalledTools?: unknown[];
    description?: string;
    isDefault?: boolean;
  }
) {
  const { slug: explicitSlug, ...rest } = data;
  const slug = await allocateSlug({
    baseLabel: data.name,
    explicitSlug,
    isTaken: async (s) => {
      const [r] = await db
        .select()
        .from(sandboxTemplate)
        .where(eq(sandboxTemplate.slug, s))
        .limit(1);
      return r != null;
    },
  });
  const rows = await db
    .insert(sandboxTemplate)
    .values({ ...rest, slug })
    .returning();
  return rows[0]!;
}

export async function updateTemplate(
  db: Database,
  id: string,
  patch: {
    name?: string;
    image?: string;
    defaultCpu?: string;
    defaultMemory?: string;
    defaultStorageGb?: number;
    defaultDockerCacheGb?: number;
    vmTemplateRef?: string;
    defaultTtlMinutes?: number;
    preInstalledTools?: unknown[];
    description?: string;
    isDefault?: boolean;
  }
) {
  const rows = await db
    .update(sandboxTemplate)
    .set(patch)
    .where(eq(sandboxTemplate.sandboxTemplateId, id))
    .returning();
  if (!rows[0]) throw new Error(`Template not found: ${id}`);
  return rows[0];
}

export async function deleteTemplate(db: Database, id: string) {
  await db
    .delete(sandboxTemplate)
    .where(eq(sandboxTemplate.sandboxTemplateId, id));
}
