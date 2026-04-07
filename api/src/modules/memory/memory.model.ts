import { eq, and, desc } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { memory } from "../../db/schema/org";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CreateMemoryInput = {
  orgId: string;
  layer: string;
  layerEntityId: string;
  type: string;
  content: string;
  tags?: unknown[];
  sourceJobId?: string;
  sourceAgentId?: string;
  status?: string;
  confidence?: number;
  approvedByPrincipalId?: string;
};

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createMemory(db: Database, data: CreateMemoryInput) {
  const rows = await db
    .insert(memory)
    .values({
      orgId: data.orgId,
      layer: data.layer,
      layerEntityId: data.layerEntityId,
      type: data.type,
      content: data.content,
      tags: data.tags ?? [],
      sourceJobId: data.sourceJobId ?? null,
      sourceAgentId: data.sourceAgentId ?? null,
      status: data.status ?? "active",
      confidence: data.confidence ?? 1.0,
      approvedByPrincipalId: data.approvedByPrincipalId ?? null,
    })
    .returning();
  return rows[0];
}

export async function getMemory(db: Database, memoryId: string) {
  const rows = await db
    .select()
    .from(memory)
    .where(eq(memory.memoryId, memoryId))
    .limit(1);
  return rows[0] ?? null;
}

export async function listMemories(
  db: Database,
  filters?: {
    orgId?: string;
    layer?: string;
    layerEntityId?: string;
    type?: string;
    status?: string;
    limit?: number;
    offset?: number;
  },
) {
  const limit = Math.min(filters?.limit ?? 50, 200);
  const offset = filters?.offset ?? 0;

  let query = db.select().from(memory);

  if (filters?.orgId) {
    query = query.where(eq(memory.orgId, filters.orgId)) as typeof query;
  }
  if (filters?.layer) {
    query = query.where(eq(memory.layer, filters.layer)) as typeof query;
  }
  if (filters?.layerEntityId) {
    query = query.where(
      eq(memory.layerEntityId, filters.layerEntityId),
    ) as typeof query;
  }
  if (filters?.type) {
    query = query.where(eq(memory.type, filters.type)) as typeof query;
  }
  if (filters?.status) {
    query = query.where(eq(memory.status, filters.status)) as typeof query;
  }

  const rows = await query
    .orderBy(desc(memory.createdAt))
    .limit(limit)
    .offset(offset);
  return { data: rows, total: rows.length };
}

export async function updateMemory(
  db: Database,
  memoryId: string,
  data: {
    content?: string;
    type?: string;
    tags?: unknown[];
    status?: string;
    confidence?: number;
  },
) {
  const rows = await db
    .update(memory)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(memory.memoryId, memoryId))
    .returning();
  return rows[0] ?? null;
}

export async function archiveMemory(db: Database, memoryId: string) {
  return updateMemory(db, memoryId, { status: "archived" });
}

// ---------------------------------------------------------------------------
// Lifecycle operations
// ---------------------------------------------------------------------------

export async function approveMemory(
  db: Database,
  memoryId: string,
  approvedByPrincipalId: string,
) {
  const rows = await db
    .update(memory)
    .set({
      status: "active",
      approvedByPrincipalId,
      updatedAt: new Date(),
    })
    .where(eq(memory.memoryId, memoryId))
    .returning();
  return rows[0] ?? null;
}

export async function supersedeMemory(
  db: Database,
  memoryId: string,
  replacementId?: string,
) {
  const rows = await db
    .update(memory)
    .set({
      status: "superseded",
      confidence: 0,
      supersededById: replacementId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(memory.memoryId, memoryId))
    .returning();
  return rows[0] ?? null;
}

export async function promoteMemory(
  db: Database,
  memoryId: string,
  targetOrgId: string,
) {
  const source = await getMemory(db, memoryId);
  if (!source) return null;
  if (source.layer !== "team") return null;

  const rows = await db
    .insert(memory)
    .values({
      orgId: targetOrgId,
      layer: "org",
      layerEntityId: targetOrgId,
      type: source.type,
      content: source.content,
      tags: source.tags as unknown[],
      sourceJobId: source.sourceJobId,
      sourceAgentId: source.sourceAgentId,
      promotedFromId: source.memoryId,
      status: "proposed",
      confidence: source.confidence,
    })
    .returning();
  return rows[0] ?? null;
}
