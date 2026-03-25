import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { allocateSlug } from "../../lib/slug";
import { kubeNode } from "../../db/schema/infra";

export async function listNodes(
  db: Database,
  filters: { clusterId: string }
) {
  return db
    .select()
    .from(kubeNode)
    .where(eq(kubeNode.clusterId, filters.clusterId));
}

export async function getNode(db: Database, id: string) {
  const rows = await db
    .select()
    .from(kubeNode)
    .where(eq(kubeNode.kubeNodeId, id));
  return rows[0] ?? null;
}

export async function addNode(
  db: Database,
  data: {
    name: string;
    slug?: string;
    clusterId: string;
    vmId?: string;
    role: string;
    ipAddress: string;
  }
) {
  const { slug: explicitSlug, ...rest } = data;
  const slug = await allocateSlug({
    baseLabel: data.name,
    explicitSlug,
    isTaken: async (s) => {
      const [r] = await db
        .select()
        .from(kubeNode)
        .where(
          and(eq(kubeNode.clusterId, data.clusterId), eq(kubeNode.slug, s))
        )
        .limit(1);
      return r != null;
    },
  });
  const rows = await db.insert(kubeNode).values({ ...rest, slug }).returning();
  return rows[0];
}

export async function removeNode(db: Database, id: string) {
  const rows = await db
    .delete(kubeNode)
    .where(eq(kubeNode.kubeNodeId, id))
    .returning();
  return rows[0] ?? null;
}

export async function pauseNode(db: Database, id: string) {
  const rows = await db
    .update(kubeNode)
    .set({ status: "paused" })
    .where(eq(kubeNode.kubeNodeId, id))
    .returning();
  return rows[0] ?? null;
}

export async function resumeNode(db: Database, id: string) {
  const rows = await db
    .update(kubeNode)
    .set({ status: "ready" })
    .where(eq(kubeNode.kubeNodeId, id))
    .returning();
  return rows[0] ?? null;
}

export async function evacuateNode(db: Database, id: string) {
  const rows = await db
    .update(kubeNode)
    .set({ status: "evacuating" })
    .where(eq(kubeNode.kubeNodeId, id))
    .returning();
  return rows[0] ?? null;
}
