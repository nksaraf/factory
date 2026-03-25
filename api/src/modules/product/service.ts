import { eq } from "drizzle-orm"
import type { Database } from "../../db/connection"
import { productModule, workItem } from "../../db/schema/product"
import { allocateSlug } from "../../lib/slug"
import type { ProductModels } from "./model"

export async function listModules(db: Database) {
  const rows = await db.select().from(productModule)
  return { data: rows, total: rows.length }
}

export async function getModule(db: Database, name: string) {
  const rows = await db
    .select()
    .from(productModule)
    .where(eq(productModule.name, name))
  return { data: rows[0] ?? null }
}

export async function registerModule(
  db: Database,
  body: ProductModels["registerModuleBody"]
) {
  const slug = await allocateSlug({
    baseLabel: body.name,
    isTaken: async (s) => {
      const existing = await db
        .select()
        .from(productModule)
        .where(eq(productModule.slug, s))
      return existing.length > 0
    },
  })
  const rows = await db
    .insert(productModule)
    .values({ ...body, slug })
    .returning()
  return { data: rows[0] }
}

export async function listWorkItems(db: Database) {
  const rows = await db.select().from(workItem)
  return { data: rows, total: rows.length }
}

export async function createWorkItem(
  db: Database,
  body: ProductModels["createWorkItemBody"]
) {
  const rows = await db.insert(workItem).values(body).returning()
  return { data: rows[0] }
}

export async function updateWorkItem(
  db: Database,
  id: string,
  body: ProductModels["updateWorkItemBody"]
) {
  const rows = await db
    .update(workItem)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(workItem.workItemId, id))
    .returning()
  return { data: rows[0] ?? null }
}
